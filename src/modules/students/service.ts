import "server-only";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { student } from "@/server/db/school/schema";
import { studentVisibility } from "@/server/tenancy/scope";
import { can, ForbiddenError, type SchoolContext } from "@/server/tenancy/context";
import { z } from "zod";
import { UserError } from "@/server/errors";
import { createStudentInput, listStudentsInput, PAGE_SIZE, studentIdSchema, type CreateStudentInput } from "./schemas";

export type StudentSummary = {
  id: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  status: string;
};

const summaryColumns = {
  id: student.id,
  admissionNumber: student.admissionNumber,
  firstName: student.firstName,
  lastName: student.lastName,
  status: student.status,
};

export async function listStudents(ctx: SchoolContext, raw: { q?: string; page?: number | string } = {}) {
  const input = listStudentsInput.parse(raw);
  const scope = studentVisibility(ctx, student.id);
  const search = input.q
    ? or(
        ilike(student.firstName, `%${escapeLike(input.q)}%`),
        ilike(student.lastName, `%${escapeLike(input.q)}%`),
        ilike(student.admissionNumber, `%${escapeLike(input.q)}%`),
      )
    : undefined;
  const where = and(scope, search);
  const rows = await ctx.db
    .select(summaryColumns)
    .from(student)
    .where(where)
    .orderBy(asc(student.lastName), asc(student.firstName), asc(student.id))
    .limit(PAGE_SIZE)
    .offset((input.page - 1) * PAGE_SIZE);

  const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(student).where(where);

  return { rows: rows as StudentSummary[], total: n, page: input.page, pageSize: PAGE_SIZE };
}

/**
 * Returns null both when the student doesn't exist and when the user may not see it,
 * so callers render 404 and record existence is never leaked (IDOR protection).
 */
export async function getStudent(ctx: SchoolContext, rawId: string) {
  const id = studentIdSchema.safeParse(rawId);
  if (!id.success) return null;
  const scope = studentVisibility(ctx, student.id);
  const [row] = await ctx.db
    .select({ ...summaryColumns, dateOfBirth: student.dateOfBirth, gender: student.gender, personId: student.personId, createdAt: student.createdAt })
    .from(student)
    .where(and(eq(student.id, id.data), scope))
    .limit(1);
  return row ?? null;
}

export type CreateStudentResult = { ok: true; id: string } | { ok: false; fieldErrors: Record<string, string[]> };

export async function createStudent(ctx: SchoolContext, raw: CreateStudentInput): Promise<CreateStudentResult> {
  if (!can(ctx, "students.create")) throw new ForbiddenError("students.create");
  const parsed = createStudentInput.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? "form");
      (fieldErrors[k] ??= []).push(issue.message);
    }
    return { ok: false, fieldErrors };
  }
  const input = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const [dupe] = await tx
      .select({ id: student.id })
      .from(student)
      .where(eq(student.admissionNumber, input.admissionNumber))
      .limit(1);
    if (dupe) return { ok: false as const, fieldErrors: { admissionNumber: ["This admission number is already in use"] } };

    const [created] = await tx
      .insert(student)
      .values({
        admissionNumber: input.admissionNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth ?? null,
        status: "registered",
      })
      .returning({ id: student.id });
    await recordSchoolAudit(tx, ctx, "student.created", { type: "student", id: created!.id }, {
      admissionNumber: input.admissionNumber,
    });
    return { ok: true as const, id: created!.id };
  });
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function updateStudent(ctx: SchoolContext, raw: unknown) {
  if (!can(ctx, "students.create")) throw new ForbiddenError("students.create");
  const v = z
    .object({
      studentId: z.string().uuid(),
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
      gender: z.enum(["female", "male", ""]).optional(),
      status: z.enum(["applicant", "registered", "enrolled", "transferred_out", "graduated", "withdrawn"]),
    })
    .parse(raw);
  const res = await ctx.db
    .update(student)
    .set({ firstName: v.firstName, lastName: v.lastName, dateOfBirth: v.dateOfBirth ?? null, gender: v.gender || null, status: v.status, updatedAt: new Date() })
    .where(eq(student.id, v.studentId))
    .returning({ id: student.id });
  if (!res.length) throw new UserError("Student not found.");
  await recordSchoolAudit(ctx.db, ctx, "student.updated", { type: "student", id: v.studentId }, { status: v.status });
}
