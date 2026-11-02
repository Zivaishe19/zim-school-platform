import "server-only";
import { and, asc, desc, eq, gte, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { disciplineIncident, dutyAssignment, schoolClass, student } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { assertCan, can, ForbiddenError, type SchoolContext } from "@/server/tenancy/context";
import { requireVisibleStudent, studentVisibility } from "@/server/tenancy/scope";
import { guardianIds, notify, peopleWithRoles } from "@/modules/comms/notify";
import { classMembers } from "@/modules/setup/service";

export const INCIDENT_CATEGORIES = ["late_coming", "uniform", "homework", "disruption", "bullying", "fighting", "dishonesty", "property_damage", "absenteeism", "other"] as const;

export async function reportIncident(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "discipline.report");
  const v = z
    .object({ studentId: z.string().uuid(), category: z.enum(INCIDENT_CATEGORIES), description: z.string().trim().min(5).max(2000), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), recommendedAction: z.string().trim().max(300).optional() })
    .parse(raw);
  // A teacher can only report on students they teach (or any, if they can view all).
  await requireVisibleStudent(ctx, v.studentId);
  const [i] = await ctx.db.insert(disciplineIncident).values({ ...v, recommendedAction: v.recommendedAction || null, reportedBy: ctx.user.id }).returning({ id: disciplineIncident.id });
  await notify(ctx.db, await peopleWithRoles(ctx.db, ["headmaster"]), { title: "New discipline report to review", source: "discipline", link: `/s/${ctx.school.slug}/discipline` });
  await recordSchoolAudit(ctx.db, ctx, "discipline.reported", { type: "discipline_incident", id: i!.id });
}

/** Reported incidents are NOT decisions: only an authorized decider approves an action. */
export async function decideIncident(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "discipline.decide");
  const v = z.object({ id: z.string().uuid(), decision: z.enum(["approved", "dismissed"]), approvedAction: z.string().trim().max(300).optional(), visibleToParent: z.string().optional() }).parse(raw);
  if (v.decision === "approved" && !v.approvedAction) throw new UserError("State the approved action (e.g. warning, detention).");
  const [i] = await ctx.db.select().from(disciplineIncident).where(eq(disciplineIncident.id, v.id));
  if (!i) throw new UserError("Incident not found.");
  if (i.status !== "reported") throw new UserError("This incident has already been decided.");
  const visible = v.decision === "approved" && Boolean(v.visibleToParent);
  await ctx.db
    .update(disciplineIncident)
    .set({ status: v.decision, approvedAction: v.approvedAction || null, visibleToParent: visible, decidedBy: ctx.user.id, decidedAt: new Date() })
    .where(eq(disciplineIncident.id, i.id));
  if (visible) {
    await notify(ctx.db, await guardianIds(ctx.db, [i.studentId]), { title: "Discipline notice", body: `Action: ${v.approvedAction}`, source: "discipline", link: `/s/${ctx.school.slug}/students/${i.studentId}?tab=discipline` });
  }
  await recordSchoolAudit(ctx.db, ctx, `discipline.${v.decision}`, { type: "discipline_incident", id: i.id }, { action: v.approvedAction, visibleToParent: visible });
}

export async function listIncidents(ctx: SchoolContext, status?: "reported" | "approved" | "dismissed") {
  if (can(ctx, "discipline.view_all") || can(ctx, "discipline.decide")) {
    return ctx.db
      .select({ i: disciplineIncident, first: student.firstName, last: student.lastName, adm: student.admissionNumber })
      .from(disciplineIncident)
      .innerJoin(student, eq(student.id, disciplineIncident.studentId))
      .where(status ? eq(disciplineIncident.status, status) : undefined)
      .orderBy(desc(disciplineIncident.occurredOn))
      .limit(300);
  }
  assertCan(ctx, "discipline.report");
  // Teachers: incidents they reported.
  return ctx.db
    .select({ i: disciplineIncident, first: student.firstName, last: student.lastName, adm: student.admissionNumber })
    .from(disciplineIncident)
    .innerJoin(student, eq(student.id, disciplineIncident.studentId))
    .where(and(eq(disciplineIncident.reportedBy, ctx.user.id), status ? eq(disciplineIncident.status, status) : undefined))
    .orderBy(desc(disciplineIncident.occurredOn))
    .limit(300);
}

/**
 * One student's record. Restricted: decision-makers see everything; the reporting teacher
 * sees their own reports; parents/students see only APPROVED incidents marked visible.
 */
export async function studentIncidents(ctx: SchoolContext, studentId: string) {
  await requireVisibleStudent(ctx, studentId);
  const full = can(ctx, "discipline.view_all") || can(ctx, "discipline.decide");
  const rows = await ctx.db.select().from(disciplineIncident).where(eq(disciplineIncident.studentId, studentId)).orderBy(desc(disciplineIncident.occurredOn));
  if (full) return rows;
  if (can(ctx, "discipline.report")) return rows.filter((r) => r.reportedBy === ctx.user.id || (r.status === "approved" && r.visibleToParent));
  return rows
    .filter((r) => r.status === "approved" && r.visibleToParent)
    .map((r) => ({ ...r, description: r.description, recommendedAction: null, reportedBy: "" }));
}

// ------------------------------------------------------------------ classroom duties
async function assertLeadsClass(ctx: SchoolContext, classId: string) {
  if (can(ctx, "settings.manage")) return;
  assertCan(ctx, "duties.manage");
  const [c] = await ctx.db.select().from(schoolClass).where(eq(schoolClass.id, classId));
  if (!c || c.classTeacherPersonId !== ctx.personId) throw new ForbiddenError("duties.manage");
}

export async function classDuties(ctx: SchoolContext, classId: string, includeEnded = false) {
  await assertLeadsClass(ctx, classId);
  return ctx.db
    .select({ d: dutyAssignment, first: student.firstName, last: student.lastName })
    .from(dutyAssignment)
    .innerJoin(student, eq(student.id, dutyAssignment.studentId))
    .where(and(eq(dutyAssignment.classId, classId), includeEnded ? undefined : or(isNull(dutyAssignment.endsOn), gte(dutyAssignment.endsOn, new Date().toISOString().slice(0, 10)))))
    .orderBy(desc(dutyAssignment.startsOn), asc(student.lastName));
}

export async function assignDuty(ctx: SchoolContext, raw: unknown) {
  const v = z
    .object({ classId: z.string().uuid(), studentId: z.string().uuid(), role: z.string().trim().min(2).max(60), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)), note: z.string().trim().max(200).optional() })
    .parse(raw);
  await assertLeadsClass(ctx, v.classId);
  const members = await classMembers(ctx, v.classId);
  if (!members.some((m) => m.id === v.studentId)) throw new UserError("That student is not in this class.");
  await ctx.db.insert(dutyAssignment).values({ ...v, endsOn: v.endsOn ?? null, note: v.note || null, assignedBy: ctx.user.id });
  await recordSchoolAudit(ctx.db, ctx, "duty.assigned", { type: "class", id: v.classId }, { studentId: v.studentId, role: v.role });
}

/** Rotating duties: assigns the role to each student in turn for `days`-long slots. */
export async function rotateDuty(ctx: SchoolContext, raw: unknown) {
  const v = z.object({ classId: z.string().uuid(), role: z.string().trim().min(2).max(60), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.coerce.number().int().min(1).max(30), perSlot: z.coerce.number().int().min(1).max(10) }).parse(raw);
  await assertLeadsClass(ctx, v.classId);
  const members = await classMembers(ctx, v.classId);
  if (!members.length) throw new UserError("This class has no students.");
  const start = Date.parse(v.startsOn);
  const rows = members.map((m, i) => {
    const slot = Math.floor(i / v.perSlot);
    const s = new Date(start + slot * v.days * 86_400_000).toISOString().slice(0, 10);
    const e = new Date(start + (slot + 1) * v.days * 86_400_000 - 86_400_000).toISOString().slice(0, 10);
    return { classId: v.classId, studentId: m.id, role: v.role, startsOn: s, endsOn: e, assignedBy: ctx.user.id, note: "rotation" };
  });
  await ctx.db.insert(dutyAssignment).values(rows);
  await recordSchoolAudit(ctx.db, ctx, "duty.rotation_created", { type: "class", id: v.classId }, { role: v.role, students: rows.length });
  return rows.length;
}

export async function endDuty(ctx: SchoolContext, dutyId: string) {
  const [d] = await ctx.db.select().from(dutyAssignment).where(eq(dutyAssignment.id, z.string().uuid().parse(dutyId)));
  if (!d) throw new UserError("Duty not found.");
  await assertLeadsClass(ctx, d.classId);
  await ctx.db.update(dutyAssignment).set({ endsOn: new Date().toISOString().slice(0, 10) }).where(eq(dutyAssignment.id, d.id));
}

export async function myClassesLed(ctx: SchoolContext) {
  if (can(ctx, "settings.manage")) return ctx.db.select({ id: schoolClass.id, name: schoolClass.name }).from(schoolClass).orderBy(asc(schoolClass.name));
  if (!ctx.personId) return [];
  return ctx.db.select({ id: schoolClass.id, name: schoolClass.name }).from(schoolClass).where(eq(schoolClass.classTeacherPersonId, ctx.personId)).orderBy(asc(schoolClass.name));
}

export function visibleStudentsCondition(ctx: SchoolContext) {
  return studentVisibility(ctx, student.id);
}
