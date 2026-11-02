import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import {
  absenceExplanation,
  attendanceMark,
  attendanceSession,
  enrolment,
  schoolClass,
  student,
  studentGuardian,
  teachingGroup,
} from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { assertCan, can, ForbiddenError, type SchoolContext } from "@/server/tenancy/context";
import { requireVisibleStudent, studentVisibility } from "@/server/tenancy/scope";
import { guardianIds, notify } from "@/modules/comms/notify";
import { classMembers, groupMembers } from "@/modules/setup/service";

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "early_departure", "approved_absence"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Registers this user may take: daily for classes they lead, lesson for groups they teach. */
export async function myRegisters(ctx: SchoolContext) {
  if (!ctx.personId) return { classes: [], groups: [] };
  const classes = await ctx.db.select({ id: schoolClass.id, name: schoolClass.name }).from(schoolClass).where(eq(schoolClass.classTeacherPersonId, ctx.personId)).orderBy(asc(schoolClass.name));
  const groups = await ctx.db.select({ id: teachingGroup.id, name: teachingGroup.name }).from(teachingGroup).where(eq(teachingGroup.teacherPersonId, ctx.personId)).orderBy(asc(teachingGroup.name));
  return { classes, groups };
}

async function assertMayTake(ctx: SchoolContext, kind: "daily" | "lesson", targetId: string) {
  if (can(ctx, "attendance.view_all") && can(ctx, "settings.manage")) return; // admin corrections
  assertCan(ctx, "attendance.take");
  const owned =
    kind === "daily"
      ? await ctx.db.select({ id: schoolClass.id }).from(schoolClass).where(and(eq(schoolClass.id, targetId), eq(schoolClass.classTeacherPersonId, ctx.personId ?? "00000000-0000-0000-0000-000000000000")))
      : await ctx.db.select({ id: teachingGroup.id }).from(teachingGroup).where(and(eq(teachingGroup.id, targetId), eq(teachingGroup.teacherPersonId, ctx.personId ?? "00000000-0000-0000-0000-000000000000")));
  if (!owned.length) throw new ForbiddenError("attendance.take");
}

export async function getRegister(ctx: SchoolContext, raw: { kind: string; targetId: string; date: string; period?: string }) {
  const kind = z.enum(["daily", "lesson"]).parse(raw.kind);
  const targetId = z.string().uuid().parse(raw.targetId);
  const date = isoDate.parse(raw.date);
  const periodLabel = kind === "lesson" ? (raw.period?.trim() || "Lesson") : null;
  if (!can(ctx, "attendance.view_all")) await assertMayTake(ctx, kind, targetId);

  const members = kind === "daily" ? await classMembers(ctx, targetId) : await groupMembers(ctx, targetId);
  const [session] = await ctx.db
    .select()
    .from(attendanceSession)
    .where(
      kind === "daily"
        ? and(eq(attendanceSession.kind, "daily"), eq(attendanceSession.date, date), eq(attendanceSession.classId, targetId))
        : and(eq(attendanceSession.kind, "lesson"), eq(attendanceSession.date, date), eq(attendanceSession.teachingGroupId, targetId), eq(attendanceSession.period, periodLabel!)),
    );
  const marks = session ? await ctx.db.select().from(attendanceMark).where(eq(attendanceMark.sessionId, session.id)) : [];
  // Approved absence explanations covering this date pre-fill as approved_absence.
  const approved = members.length
    ? await ctx.db
        .select({ studentId: absenceExplanation.studentId })
        .from(absenceExplanation)
        .where(and(eq(absenceExplanation.status, "approved"), lte(absenceExplanation.dateFrom, date), gte(absenceExplanation.dateTo, date), inArray(absenceExplanation.studentId, members.map((m) => m.id))))
    : [];
  return {
    kind,
    date,
    period: periodLabel,
    taken: Boolean(session),
    rows: members.map((m) => {
      const mk = marks.find((x) => x.studentId === m.id);
      return { ...m, status: (mk?.status ?? (approved.some((a) => a.studentId === m.id) ? "approved_absence" : "present")) as AttendanceStatus, note: mk?.note ?? "" };
    }),
  };
}

/**
 * Saves a register (idempotent: re-saving corrects it). Daily absences notify guardians
 * once per day. Lesson absences are recorded separately and never counted as full-day absences.
 */
export async function saveRegister(ctx: SchoolContext, values: Record<string, string | string[]>) {
  const kind = z.enum(["daily", "lesson"]).parse(values.kind);
  const targetId = z.string().uuid().parse(values.targetId);
  const date = isoDate.parse(values.date);
  if (date > new Date().toISOString().slice(0, 10)) throw new UserError("Attendance cannot be recorded for a future date.");
  const periodLabel = kind === "lesson" ? String(values.period || "Lesson").slice(0, 40) : null;
  await assertMayTake(ctx, kind, targetId);

  const members = kind === "daily" ? await classMembers(ctx, targetId) : await groupMembers(ctx, targetId);
  const entries = members.map((m) => ({
    studentId: m.id,
    status: z.enum(ATTENDANCE_STATUSES).parse(values[`status_${m.id}`] ?? "present"),
    note: String(values[`note_${m.id}`] ?? "").slice(0, 200) || null,
  }));

  const newlyAbsent = await ctx.db.transaction(async (tx) => {
    const where =
      kind === "daily"
        ? and(eq(attendanceSession.kind, "daily"), eq(attendanceSession.date, date), eq(attendanceSession.classId, targetId))
        : and(eq(attendanceSession.kind, "lesson"), eq(attendanceSession.date, date), eq(attendanceSession.teachingGroupId, targetId), eq(attendanceSession.period, periodLabel!));
    let [session] = await tx.select().from(attendanceSession).where(where);
    const before = session ? await tx.select().from(attendanceMark).where(eq(attendanceMark.sessionId, session.id)) : [];
    if (!session) {
      [session] = await tx
        .insert(attendanceSession)
        .values({ kind, date, classId: kind === "daily" ? targetId : null, teachingGroupId: kind === "lesson" ? targetId : null, period: periodLabel, takenBy: ctx.user.id })
        .returning();
    } else {
      await tx.update(attendanceSession).set({ takenBy: ctx.user.id, takenAt: new Date() }).where(eq(attendanceSession.id, session.id));
    }
    for (const e of entries) {
      await tx
        .insert(attendanceMark)
        .values({ sessionId: session!.id, ...e })
        .onConflictDoUpdate({ target: [attendanceMark.sessionId, attendanceMark.studentId], set: { status: e.status, note: e.note } });
    }
    await recordSchoolAudit(tx, ctx, before.length ? "attendance.corrected" : "attendance.taken", { type: "attendance_session", id: session!.id }, { kind, date, students: entries.length });
    return kind === "daily" ? entries.filter((e) => e.status === "absent" && before.find((b) => b.studentId === e.studentId)?.status !== "absent").map((e) => e.studentId) : [];
  });

  for (const sid of newlyAbsent) {
    const s = members.find((m) => m.id === sid)!;
    await notify(ctx.db, await guardianIds(ctx.db, [sid]), {
      title: `${s.firstName} was marked absent on ${date}`,
      body: "If this is unexpected, please contact the school or submit an absence explanation.",
      link: `/s/${ctx.school.slug}/attendance/explain?studentId=${sid}&date=${date}`,
      source: "attendance",
    });
  }
  return { saved: entries.length, notified: newlyAbsent.length };
}

/** Daily-register summary for one student (lesson absences listed separately). */
export async function studentAttendance(ctx: SchoolContext, studentId: string, from?: string, to?: string) {
  await requireVisibleStudent(ctx, studentId);
  const conds = [eq(attendanceMark.studentId, studentId)];
  if (from) conds.push(gte(attendanceSession.date, isoDate.parse(from)));
  if (to) conds.push(lte(attendanceSession.date, isoDate.parse(to)));
  const rows = await ctx.db
    .select({ date: attendanceSession.date, kind: attendanceSession.kind, period: attendanceSession.period, status: attendanceMark.status, note: attendanceMark.note, groupName: teachingGroup.name })
    .from(attendanceMark)
    .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceMark.sessionId))
    .leftJoin(teachingGroup, eq(teachingGroup.id, attendanceSession.teachingGroupId))
    .where(and(...conds))
    .orderBy(desc(attendanceSession.date))
    .limit(400);
  const daily = rows.filter((r) => r.kind === "daily");
  const count = (s: string) => daily.filter((r) => r.status === s).length;
  return {
    summary: { days: daily.length, present: count("present"), late: count("late"), absent: count("absent"), approved: count("approved_absence"), early: count("early_departure") },
    daily,
    lessonAbsences: rows.filter((r) => r.kind === "lesson" && r.status !== "present"),
  };
}

/** Class summary for a date range (daily registers). */
export async function classAttendanceReport(ctx: SchoolContext, classId: string, from: string, to: string) {
  if (!can(ctx, "attendance.view_all")) await assertMayTake(ctx, "daily", classId);
  return ctx.db
    .select({
      studentId: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      present: sql<number>`count(*) filter (where ${attendanceMark.status} = 'present')::int`,
      late: sql<number>`count(*) filter (where ${attendanceMark.status} = 'late')::int`,
      absent: sql<number>`count(*) filter (where ${attendanceMark.status} = 'absent')::int`,
      approved: sql<number>`count(*) filter (where ${attendanceMark.status} = 'approved_absence')::int`,
      days: sql<number>`count(*)::int`,
    })
    .from(attendanceMark)
    .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceMark.sessionId))
    .innerJoin(student, eq(student.id, attendanceMark.studentId))
    .where(and(eq(attendanceSession.kind, "daily"), eq(attendanceSession.classId, classId), gte(attendanceSession.date, isoDate.parse(from)), lte(attendanceSession.date, isoDate.parse(to))))
    .groupBy(student.id, student.firstName, student.lastName)
    .orderBy(asc(student.lastName));
}

/** Whole-school daily attendance rate for the last N days (headmaster dashboard). */
export async function schoolAttendanceRate(ctx: SchoolContext, days = 7) {
  assertCan(ctx, "attendance.view_all");
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [r] = await ctx.db
    .select({
      total: sql<number>`count(*)::int`,
      present: sql<number>`count(*) filter (where ${attendanceMark.status} in ('present','late'))::int`,
      absent: sql<number>`count(*) filter (where ${attendanceMark.status} = 'absent')::int`,
    })
    .from(attendanceMark)
    .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceMark.sessionId))
    .where(and(eq(attendanceSession.kind, "daily"), gte(attendanceSession.date, since)));
  return { ...r!, rate: r && r.total ? Math.round((r.present / r.total) * 1000) / 10 : null };
}

// ------------------------------------------------------------------ absence explanations
export async function submitExplanation(ctx: SchoolContext, raw: unknown) {
  const v = z.object({ studentId: z.string().uuid(), dateFrom: isoDate, dateTo: isoDate, reason: z.string().trim().min(5).max(1000) }).parse(raw);
  if (v.dateTo < v.dateFrom) throw new UserError("The end date is before the start date.");
  // Only a linked guardian (or staff who can see the student) may explain an absence.
  const isGuardian = ctx.personId
    ? (await ctx.db.select().from(studentGuardian).where(and(eq(studentGuardian.studentId, v.studentId), eq(studentGuardian.guardianPersonId, ctx.personId)))).length > 0
    : false;
  if (!isGuardian) {
    assertCan(ctx, "absence.review");
    await requireVisibleStudent(ctx, v.studentId);
  }
  const [row] = await ctx.db.insert(absenceExplanation).values({ ...v, submittedBy: ctx.user.id }).returning({ id: absenceExplanation.id });
  await recordSchoolAudit(ctx.db, ctx, "attendance.explanation_submitted", { type: "absence_explanation", id: row!.id });
}

export async function listExplanations(ctx: SchoolContext, status: "pending" | "approved" | "rejected" | "all" = "pending") {
  const scope = can(ctx, "absence.review") ? studentVisibility(ctx, absenceExplanation.studentId) : undefined;
  if (!can(ctx, "absence.review")) {
    // Guardians see their own submissions.
    if (!ctx.personId) return [];
  }
  return ctx.db
    .select({ id: absenceExplanation.id, studentId: student.id, firstName: student.firstName, lastName: student.lastName, dateFrom: absenceExplanation.dateFrom, dateTo: absenceExplanation.dateTo, reason: absenceExplanation.reason, status: absenceExplanation.status, reviewNote: absenceExplanation.reviewNote, createdAt: absenceExplanation.createdAt })
    .from(absenceExplanation)
    .innerJoin(student, eq(student.id, absenceExplanation.studentId))
    .where(
      and(
        status === "all" ? undefined : eq(absenceExplanation.status, status),
        can(ctx, "absence.review") ? scope : or(eq(absenceExplanation.submittedBy, ctx.user.id), studentVisibility(ctx, absenceExplanation.studentId)),
      ),
    )
    .orderBy(desc(absenceExplanation.createdAt))
    .limit(200);
}

/** Approving converts matching "absent" marks in that date range to "approved_absence". */
export async function reviewExplanation(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "absence.review");
  const v = z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(500).optional() }).parse(raw);
  const [e] = await ctx.db.select().from(absenceExplanation).where(eq(absenceExplanation.id, v.id));
  if (!e) throw new UserError("Explanation not found.");
  await requireVisibleStudent(ctx, e.studentId);
  if (e.status !== "pending") throw new UserError("This explanation has already been reviewed.");
  await ctx.db.transaction(async (tx) => {
    await tx.update(absenceExplanation).set({ status: v.decision, reviewedBy: ctx.user.id, reviewNote: v.note || null }).where(eq(absenceExplanation.id, e.id));
    if (v.decision === "approved") {
      const sessions = tx.select({ id: attendanceSession.id }).from(attendanceSession).where(and(gte(attendanceSession.date, e.dateFrom), lte(attendanceSession.date, e.dateTo)));
      await tx
        .update(attendanceMark)
        .set({ status: "approved_absence" })
        .where(and(eq(attendanceMark.studentId, e.studentId), eq(attendanceMark.status, "absent"), inArray(attendanceMark.sessionId, sessions)));
    }
    await recordSchoolAudit(tx, ctx, `attendance.explanation_${v.decision}`, { type: "absence_explanation", id: e.id });
  });
  const submitter = await ctx.db.select({ id: studentGuardian.guardianPersonId }).from(studentGuardian).where(eq(studentGuardian.studentId, e.studentId));
  await notify(ctx.db, submitter.map((s) => s.id), { title: `Absence explanation ${v.decision}`, body: v.note, source: "attendance", link: `/s/${ctx.school.slug}/attendance` });
}

export async function enrolledClassIds(ctx: SchoolContext, studentId: string) {
  return (await ctx.db.select({ id: enrolment.classId }).from(enrolment).where(eq(enrolment.studentId, studentId))).map((r) => r.id);
}
