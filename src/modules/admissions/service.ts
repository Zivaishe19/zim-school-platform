import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, count } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { platformDb } from "@/server/db/platform/client";
import { platformAuditEvent } from "@/server/db/platform/schema";
import { application, applicationDocument, fileObject, student } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { storeUpload } from "@/server/files/storage";
import type { SchoolDb } from "@/server/tenancy/client-cache";
import { assertCan, type SchoolContext } from "@/server/tenancy/context";

/** Allowed status transitions. Application status is separate from registration/enrolment. */
const TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["under_review", "rejected"],
  under_review: ["info_required", "accepted", "rejected"],
  info_required: ["under_review", "rejected"],
  accepted: [],
  rejected: [],
};

const ENTRY_LEVEL: Record<string, number> = { form1: 1, form4: 4, lower6: 5 };

export const applicationInput = z.object({
  entryType: z.enum(["form1", "form4", "lower6", "transfer"]),
  // Blank select = not given (must not become 0).
  applyingForLevel: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(6).optional()),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  gender: z.enum(["female", "male", ""]).optional(),
  previousSchool: z.string().trim().max(160).optional(),
  guardianName: z.string().trim().min(2).max(120),
  guardianPhone: z.string().trim().regex(/^[+0-9 ()-]{7,20}$/, "enter a valid phone number"),
  guardianEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
});

function reference(): string {
  return `APP-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function insertApplication(db: SchoolDb, v: z.infer<typeof applicationInput>, source: "online" | "walk_in", createdBy: string | null) {
  const level = v.entryType === "transfer" ? v.applyingForLevel : ENTRY_LEVEL[v.entryType];
  if (!level) throw new UserError("Choose the form the transfer is for.");
  const [row] = await db
    .insert(application)
    .values({
      reference: reference(),
      entryType: v.entryType,
      applyingForLevel: level,
      firstName: v.firstName,
      lastName: v.lastName,
      dateOfBirth: v.dateOfBirth ?? null,
      gender: v.gender || null,
      previousSchool: v.previousSchool || null,
      guardianName: v.guardianName,
      guardianPhone: v.guardianPhone,
      guardianEmail: v.guardianEmail ?? null,
      source,
      status: "submitted",
      createdBy,
    })
    .returning({ id: application.id, reference: application.reference });
  return row!;
}

/**
 * PUBLIC online application (no login). Caller has resolved the school from its slug and
 * passes its database. Max 5 submissions per IP per hour, counted in the platform audit log.
 */
export async function submitOnlineApplication(db: SchoolDb, schoolId: string, raw: unknown, ip: string | null) {
  const v = applicationInput.parse(raw);
  if (ip) {
    const [{ n } = { n: 0 }] = await platformDb()
      .select({ n: count() })
      .from(platformAuditEvent)
      .where(and(eq(platformAuditEvent.action, "admissions.online_submitted"), eq(platformAuditEvent.ipAddress, ip), gt(platformAuditEvent.at, new Date(Date.now() - 3_600_000))));
    if (n >= 5) throw new UserError("Too many applications from this network. Please try again later or apply at the school.");
  }
  const row = await insertApplication(db, v, "online", null);
  await platformDb().insert(platformAuditEvent).values({ action: "admissions.online_submitted", schoolId, ipAddress: ip, targetType: "application", targetId: row.id });
  return row;
}

export async function createWalkIn(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "admissions.manage");
  const row = await insertApplication(ctx.db, applicationInput.parse(raw), "walk_in", ctx.user.id);
  await recordSchoolAudit(ctx.db, ctx, "admissions.walk_in_created", { type: "application", id: row.id });
  return row;
}

export async function listApplications(ctx: SchoolContext, status?: string) {
  assertCan(ctx, "admissions.manage");
  const valid = ["draft", "submitted", "under_review", "info_required", "accepted", "rejected"] as const;
  const st = valid.find((s) => s === status);
  return ctx.db.select().from(application).where(st ? eq(application.status, st) : undefined).orderBy(desc(application.createdAt)).limit(300);
}

export async function getApplication(ctx: SchoolContext, id: string) {
  assertCan(ctx, "admissions.manage");
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await ctx.db.select().from(application).where(eq(application.id, id));
  if (!row) return null;
  const docs = await ctx.db
    .select({ id: applicationDocument.id, kind: applicationDocument.kind, fileId: fileObject.id, name: fileObject.originalName, physical: applicationDocument.receivedPhysically })
    .from(applicationDocument)
    .innerJoin(fileObject, eq(fileObject.id, applicationDocument.fileId))
    .where(eq(applicationDocument.applicationId, id));
  return { ...row, documents: docs, nextStatuses: TRANSITIONS[row.status] ?? [] };
}

export async function addApplicationDocument(ctx: SchoolContext, applicationId: string, kind: string, file: File | null, physical: boolean) {
  assertCan(ctx, "admissions.manage");
  const k = z.string().trim().min(2).max(60).parse(kind);
  const fileId = await storeUpload(ctx, file, "admission_document", { required: true });
  await ctx.db.insert(applicationDocument).values({ applicationId, fileId: fileId!, kind: k, receivedPhysically: physical });
  await recordSchoolAudit(ctx.db, ctx, "admissions.document_added", { type: "application", id: applicationId }, { kind: k });
}

/** Moves an application through its workflow. Accepting creates a REGISTERED student (not enrolled). */
export async function decideApplication(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "admissions.manage");
  const v = z
    .object({ applicationId: z.string().uuid(), status: z.enum(["under_review", "info_required", "accepted", "rejected"]), note: z.string().trim().max(1000).optional(), admissionNumber: z.string().trim().max(30).optional() })
    .parse(raw);
  return ctx.db.transaction(async (tx) => {
    const [a] = await tx.select().from(application).where(eq(application.id, v.applicationId)).for("update");
    if (!a) throw new UserError("Application not found.");
    if (!(TRANSITIONS[a.status] ?? []).includes(v.status)) throw new UserError(`An application that is ${a.status.replace("_", " ")} cannot become ${v.status.replace("_", " ")}.`);
    let studentId: string | null = null;
    if (v.status === "accepted") {
      if (!v.admissionNumber) throw new UserError("Give the admission number for the new student.");
      const dupe = await tx.select({ id: student.id }).from(student).where(eq(student.admissionNumber, v.admissionNumber));
      if (dupe.length) throw new UserError("That admission number is already in use.");
      const [s] = await tx
        .insert(student)
        .values({ admissionNumber: v.admissionNumber, firstName: a.firstName, lastName: a.lastName, dateOfBirth: a.dateOfBirth, gender: a.gender, status: "registered" })
        .returning({ id: student.id });
      studentId = s!.id;
    }
    await tx
      .update(application)
      .set({ status: v.status, decisionNote: v.note || a.decisionNote, decidedBy: ctx.user.id, decidedAt: new Date(), studentId: studentId ?? a.studentId, updatedAt: new Date() })
      .where(eq(application.id, a.id));
    await recordSchoolAudit(tx, ctx, `admissions.${v.status}`, { type: "application", id: a.id }, { studentId });
    return { studentId };
  });
}
