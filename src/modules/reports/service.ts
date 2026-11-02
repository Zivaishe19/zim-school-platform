import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { academicYear, enrolment, form, progression, reportCard, schoolClass, student, teachingGroup, term } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { assertCan, can, ForbiddenError, type SchoolContext } from "@/server/tenancy/context";
import { requireVisibleStudent } from "@/server/tenancy/scope";
import { studentAttendance } from "@/modules/attendance/service";
import { studentResults } from "@/modules/assessments/service";
import { guardianIds, notify, studentPersonIds } from "@/modules/comms/notify";
import { classMembers } from "@/modules/setup/service";

export type ReportSnapshot = {
  student: { name: string; admissionNumber: string };
  className: string;
  term: { name: string; startsOn: string; endsOn: string };
  subjects: { subject: string; teacher: string | null; percent: number | null; grade: string | null; incomplete: boolean }[];
  attendance: { days: number; present: number; late: number; absent: number; approved: number };
  classTeacherComment: string | null;
  headComment: string | null;
  generatedAt: string;
};

async function assertClassTeacherOrViewer(ctx: SchoolContext, classId: string, needPrepare = false) {
  if (!needPrepare && (can(ctx, "reports.view_all") || can(ctx, "reports.approve"))) return;
  assertCan(ctx, "reports.prepare");
  const [c] = await ctx.db.select().from(schoolClass).where(eq(schoolClass.id, classId));
  if (!c || c.classTeacherPersonId !== ctx.personId) throw new ForbiddenError("reports.prepare");
}

/** Live (not yet frozen) report data, built from published+unpublished marks for staff. */
export async function buildReport(ctx: SchoolContext, studentId: string, termId: string, classId: string, comments: { ct: string | null; head: string | null }): Promise<ReportSnapshot> {
  const [s] = await ctx.db.select().from(student).where(eq(student.id, studentId));
  const [t] = await ctx.db.select().from(term).where(eq(term.id, termId));
  const [c] = await ctx.db.select().from(schoolClass).where(eq(schoolClass.id, classId));
  if (!s || !t || !c) throw new UserError("Report data not found.");
  const results = await studentResults(ctx, studentId, termId);
  const att = await studentAttendance(ctx, studentId, t.startsOn, t.endsOn);
  return {
    student: { name: `${s.firstName} ${s.lastName}`, admissionNumber: s.admissionNumber },
    className: c.name,
    term: { name: t.name, startsOn: t.startsOn, endsOn: t.endsOn },
    subjects: results.map((r) => ({ subject: r.subject, teacher: r.teacher, percent: r.percent, grade: r.grade, incomplete: r.incomplete })),
    attendance: { days: att.summary.days, present: att.summary.present, late: att.summary.late, absent: att.summary.absent, approved: att.summary.approved },
    classTeacherComment: comments.ct,
    headComment: comments.head,
    generatedAt: new Date().toISOString(),
  };
}

export async function classReports(ctx: SchoolContext, classId: string, termId: string) {
  await assertClassTeacherOrViewer(ctx, classId);
  const members = await classMembers(ctx, classId);
  const reports = members.length ? await ctx.db.select().from(reportCard).where(and(eq(reportCard.termId, termId), inArray(reportCard.studentId, members.map((m) => m.id)))) : [];
  return members.map((m) => ({ ...m, report: reports.find((r) => r.studentId === m.id) ?? null }));
}

/** Class teacher writes the comment and submits for approval (or saves a draft). */
export async function saveTeacherComment(ctx: SchoolContext, raw: unknown) {
  const v = z.object({ studentId: z.string().uuid(), termId: z.string().uuid(), classId: z.string().uuid(), comment: z.string().trim().max(1000), submit: z.string().optional() }).parse(raw);
  await assertClassTeacherOrViewer(ctx, v.classId, true);
  const [existing] = await ctx.db.select().from(reportCard).where(and(eq(reportCard.studentId, v.studentId), eq(reportCard.termId, v.termId)));
  if (existing && (existing.status === "approved" || existing.status === "published")) throw new UserError("This report is already approved. Ask the headmaster to reopen it.");
  const status = v.submit ? "submitted" : "draft";
  await ctx.db
    .insert(reportCard)
    .values({ studentId: v.studentId, termId: v.termId, classId: v.classId, classTeacherComment: v.comment || null, status })
    .onConflictDoUpdate({ target: [reportCard.studentId, reportCard.termId], set: { classTeacherComment: v.comment || null, status, updatedAt: new Date() } });
  await recordSchoolAudit(ctx.db, ctx, `report.${status}`, { type: "student", id: v.studentId }, { termId: v.termId });
}

/** Headmaster approves: the report data is FROZEN into a snapshot at this moment. */
export async function approveReport(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "reports.approve");
  const v = z.object({ reportId: z.string().uuid(), headComment: z.string().trim().max(1000).optional() }).parse(raw);
  const [r] = await ctx.db.select().from(reportCard).where(eq(reportCard.id, v.reportId));
  if (!r) throw new UserError("Report not found.");
  if (r.status !== "submitted") throw new UserError("Only reports submitted by the class teacher can be approved.");
  const snap = await buildReport(ctx, r.studentId, r.termId, r.classId, { ct: r.classTeacherComment, head: v.headComment || null });
  await ctx.db.update(reportCard).set({ status: "approved", headComment: v.headComment || null, snapshot: snap, approvedBy: ctx.user.id, updatedAt: new Date() }).where(eq(reportCard.id, r.id));
  await recordSchoolAudit(ctx.db, ctx, "report.approved", { type: "report_card", id: r.id });
}

export async function publishReports(ctx: SchoolContext, reportIds: string[]) {
  assertCan(ctx, "reports.approve");
  const ids = z.array(z.string().uuid()).min(1, "Choose reports to publish").parse(reportIds);
  const done = await ctx.db
    .update(reportCard)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(reportCard.id, ids), eq(reportCard.status, "approved")))
    .returning({ id: reportCard.id, studentId: reportCard.studentId });
  for (const d of done) {
    await notify(ctx.db, [...(await guardianIds(ctx.db, [d.studentId])), ...(await studentPersonIds(ctx.db, [d.studentId]))], {
      title: "A report card has been published",
      source: "reports",
      link: `/s/${ctx.school.slug}/reports/${d.id}`,
    });
  }
  await recordSchoolAudit(ctx.db, ctx, "report.published", { type: "report_card", id: ids.join(",").slice(0, 200) }, { count: done.length });
  return done.length;
}

/** Controlled correction: reopening keeps the old snapshot in the audit log. */
export async function reopenReport(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "reports.approve");
  const v = z.object({ reportId: z.string().uuid(), reason: z.string().trim().min(5, "Give a reason").max(500) }).parse(raw);
  const [r] = await ctx.db.select().from(reportCard).where(eq(reportCard.id, v.reportId));
  if (!r) throw new UserError("Report not found.");
  await ctx.db.transaction(async (tx) => {
    await recordSchoolAudit(tx, ctx, "report.reopened", { type: "report_card", id: r.id }, { reason: v.reason, previousStatus: r.status, previousSnapshot: r.snapshot });
    await tx.update(reportCard).set({ status: "draft", publishedAt: null, snapshot: null, updatedAt: new Date() }).where(eq(reportCard.id, r.id));
  });
}

/** One report. Parents and students see only PUBLISHED reports of visible students. */
export async function getReport(ctx: SchoolContext, reportId: string) {
  if (!z.string().uuid().safeParse(reportId).success) return null;
  const [r] = await ctx.db.select().from(reportCard).where(eq(reportCard.id, reportId));
  if (!r) return null;
  try {
    await requireVisibleStudent(ctx, r.studentId);
  } catch {
    return null;
  }
  const staff = can(ctx, "reports.view_all") || can(ctx, "reports.approve") || can(ctx, "reports.prepare");
  if (!staff && r.status !== "published") return null;
  const data = r.snapshot ? (r.snapshot as unknown as ReportSnapshot) : await buildReport(ctx, r.studentId, r.termId, r.classId, { ct: r.classTeacherComment, head: r.headComment });
  return { report: r, data, frozen: Boolean(r.snapshot) };
}

export async function publishedReportsFor(ctx: SchoolContext, studentId: string) {
  await requireVisibleStudent(ctx, studentId);
  return ctx.db
    .select({ id: reportCard.id, termName: term.name, status: reportCard.status, publishedAt: reportCard.publishedAt })
    .from(reportCard)
    .innerJoin(term, eq(term.id, reportCard.termId))
    .where(and(eq(reportCard.studentId, studentId), can(ctx, "students.view_all") || can(ctx, "students.view_taught") ? undefined : eq(reportCard.status, "published")))
    .orderBy(asc(term.startsOn));
}

export async function submittedReports(ctx: SchoolContext) {
  assertCan(ctx, "reports.approve");
  return ctx.db
    .select({ id: reportCard.id, status: reportCard.status, first: student.firstName, last: student.lastName, className: schoolClass.name, termName: term.name })
    .from(reportCard)
    .innerJoin(student, eq(student.id, reportCard.studentId))
    .innerJoin(schoolClass, eq(schoolClass.id, reportCard.classId))
    .innerJoin(term, eq(term.id, reportCard.termId))
    .where(inArray(reportCard.status, ["submitted", "approved"]))
    .orderBy(asc(schoolClass.name), asc(student.lastName));
}

// ------------------------------------------------------------------ progression and year closure
/** Proposes next-year placements. Nothing moves until staff review and apply them. */
export async function proposeProgression(ctx: SchoolContext, fromYearId: string, toYearId: string) {
  assertCan(ctx, "progression.manage");
  if (fromYearId === toYearId) throw new UserError("Choose a different target year.");
  const rows = await ctx.db
    .select({ studentId: enrolment.studentId, classId: enrolment.classId, level: form.level })
    .from(enrolment)
    .innerJoin(schoolClass, eq(schoolClass.id, enrolment.classId))
    .innerJoin(form, eq(form.id, schoolClass.formId))
    .where(and(eq(enrolment.academicYearId, fromYearId), eq(enrolment.status, "active")));
  for (const r of rows) {
    const decision = r.level === 6 ? "graduate" : "proposed";
    await ctx.db.insert(progression).values({ fromYearId, toYearId, studentId: r.studentId, fromClassId: r.classId, decision }).onConflictDoNothing();
  }
  await recordSchoolAudit(ctx.db, ctx, "progression.proposed", { type: "academic_year", id: fromYearId }, { students: rows.length });
  return rows.length;
}

export async function listProgression(ctx: SchoolContext, fromYearId: string) {
  assertCan(ctx, "progression.manage");
  return ctx.db
    .select({ p: progression, first: student.firstName, last: student.lastName, fromClass: schoolClass.name, level: form.level })
    .from(progression)
    .innerJoin(student, eq(student.id, progression.studentId))
    .innerJoin(schoolClass, eq(schoolClass.id, progression.fromClassId))
    .innerJoin(form, eq(form.id, schoolClass.formId))
    .where(eq(progression.fromYearId, fromYearId))
    .orderBy(asc(form.level), asc(schoolClass.name), asc(student.lastName));
}

export async function decideProgression(ctx: SchoolContext, values: Record<string, string | string[]>) {
  assertCan(ctx, "progression.manage");
  const fromYearId = z.string().uuid().parse(values.fromYearId);
  const rows = await ctx.db.select().from(progression).where(and(eq(progression.fromYearId, fromYearId)));
  for (const r of rows) {
    if (r.appliedAt) continue;
    const d = values[`decision_${r.id}`];
    const c = values[`class_${r.id}`];
    if (d === undefined) continue;
    const decision = z.enum(["proposed", "promote", "repeat", "leave", "graduate"]).parse(d);
    const toClassId = typeof c === "string" && c ? z.string().uuid().parse(c) : null;
    await ctx.db.update(progression).set({ decision, toClassId, decidedBy: ctx.user.id }).where(eq(progression.id, r.id));
  }
  await recordSchoolAudit(ctx.db, ctx, "progression.decided", { type: "academic_year", id: fromYearId });
}

/** Applies decided placements: creates next-year enrolments; previous years stay untouched. */
export async function applyProgression(ctx: SchoolContext, fromYearId: string) {
  assertCan(ctx, "progression.manage");
  const rows = await ctx.db.select().from(progression).where(eq(progression.fromYearId, fromYearId));
  const pending = rows.filter((r) => !r.appliedAt);
  const undecided = pending.filter((r) => r.decision === "proposed" || ((r.decision === "promote" || r.decision === "repeat") && !r.toClassId));
  if (undecided.length) throw new UserError(`${undecided.length} student(s) still need a decision and target class.`);
  await ctx.db.transaction(async (tx) => {
    for (const r of pending) {
      if (r.decision === "promote" || r.decision === "repeat") {
        await tx.insert(enrolment).values({ studentId: r.studentId, academicYearId: r.toYearId, classId: r.toClassId!, status: "active", isRepeat: r.decision === "repeat" }).onConflictDoNothing();
      }
      await tx.update(enrolment).set({ status: r.decision === "leave" ? "withdrawn" : "completed" }).where(and(eq(enrolment.studentId, r.studentId), eq(enrolment.academicYearId, fromYearId)));
      if (r.decision === "leave") await tx.update(student).set({ status: "withdrawn" }).where(eq(student.id, r.studentId));
      if (r.decision === "graduate") await tx.update(student).set({ status: "graduated" }).where(eq(student.id, r.studentId));
      await tx.update(progression).set({ appliedAt: new Date() }).where(eq(progression.id, r.id));
    }
    await recordSchoolAudit(tx, ctx, "progression.applied", { type: "academic_year", id: fromYearId }, { students: pending.length });
  });
  return pending.length;
}

/** Copies classes and teaching groups (structure only, NO students or records) into another year. */
export async function copyYearStructure(ctx: SchoolContext, fromYearId: string, toYearId: string) {
  assertCan(ctx, "settings.manage");
  const classes = await ctx.db.select().from(schoolClass).where(eq(schoolClass.academicYearId, fromYearId));
  const groups = await ctx.db.select().from(teachingGroup).where(eq(teachingGroup.academicYearId, fromYearId));
  let n = 0;
  await ctx.db.transaction(async (tx) => {
    const map = new Map<string, string>();
    for (const c of classes) {
      const [nc] = await tx.insert(schoolClass).values({ academicYearId: toYearId, formId: c.formId, name: c.name, stream: c.stream, roomId: c.roomId, classTeacherPersonId: c.classTeacherPersonId }).onConflictDoNothing().returning({ id: schoolClass.id });
      if (nc) { map.set(c.id, nc.id); n++; }
    }
    for (const g of groups) {
      await tx.insert(teachingGroup).values({ academicYearId: toYearId, subjectId: g.subjectId, formId: g.formId, classId: g.classId ? (map.get(g.classId) ?? null) : null, name: g.name, teacherPersonId: g.teacherPersonId }).onConflictDoNothing();
    }
    await recordSchoolAudit(tx, ctx, "settings.year_structure_copied", { type: "academic_year", id: toYearId }, { from: fromYearId, classes: classes.length, groups: groups.length });
  });
  return n;
}

/** Closing a year locks its marks and attendance; nothing is deleted. */
export async function closeYear(ctx: SchoolContext, yearId: string) {
  assertCan(ctx, "progression.manage");
  const pending = await ctx.db.select({ id: progression.id }).from(progression).where(and(eq(progression.fromYearId, yearId)));
  const unapplied = (await ctx.db.select().from(progression).where(eq(progression.fromYearId, yearId))).filter((p) => !p.appliedAt);
  if (!pending.length) throw new UserError("Propose and apply progression before closing the year.");
  if (unapplied.length) throw new UserError(`${unapplied.length} progression decision(s) have not been applied yet.`);
  await ctx.db.transaction(async (tx) => {
    await tx.update(academicYear).set({ status: "closed" }).where(eq(academicYear.id, yearId));
    await tx.update(term).set({ status: "closed" }).where(eq(term.academicYearId, yearId));
    await recordSchoolAudit(tx, ctx, "year.closed", { type: "academic_year", id: yearId });
  });
}
