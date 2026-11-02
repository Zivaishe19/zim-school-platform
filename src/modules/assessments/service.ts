import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import {
  academicYear,
  assessment,
  fileObject,
  gradingScale,
  groupMember,
  learningMaterial,
  mark,
  person,
  subject,
  submission,
  teachingGroup,
  term,
} from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { storeUpload } from "@/server/files/storage";
import { assertCan, can, ForbiddenError, type SchoolContext } from "@/server/tenancy/context";
import { myStudentRecord, requireVisibleStudent } from "@/server/tenancy/scope";
import { notify, studentPersonIds } from "@/modules/comms/notify";
import { groupMembers } from "@/modules/setup/service";

/**
 * Default scales are a STARTING POINT, editable per school in Setup > Grading.
 * They are common internal conversions, not official ZIMSEC/Cambridge grade boundaries
 * (those are set per exam session by the boards).
 */
export const DEFAULT_SCALES = [
  { name: "ZIMSEC O Level (school default)", examBoard: "zimsec" as const, bands: [{ grade: "A", min: 75 }, { grade: "B", min: 65 }, { grade: "C", min: 50 }, { grade: "D", min: 40 }, { grade: "E", min: 30 }, { grade: "U", min: 0 }] },
  { name: "Cambridge IGCSE (school default)", examBoard: "cambridge" as const, bands: [{ grade: "A*", min: 90 }, { grade: "A", min: 80 }, { grade: "B", min: 70 }, { grade: "C", min: 60 }, { grade: "D", min: 50 }, { grade: "E", min: 40 }, { grade: "F", min: 30 }, { grade: "G", min: 20 }, { grade: "U", min: 0 }] },
  { name: "Internal (school default)", examBoard: "internal" as const, bands: [{ grade: "A", min: 75 }, { grade: "B", min: 60 }, { grade: "C", min: 50 }, { grade: "D", min: 40 }, { grade: "U", min: 0 }] },
];

export async function listScales(ctx: SchoolContext) {
  const rows = await ctx.db.select().from(gradingScale).orderBy(asc(gradingScale.name));
  if (rows.length) return rows;
  await ctx.db.insert(gradingScale).values(DEFAULT_SCALES).onConflictDoNothing();
  return ctx.db.select().from(gradingScale).orderBy(asc(gradingScale.name));
}

export async function saveScale(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z.object({ id: z.string().uuid(), bands: z.string() }).parse(raw);
  // "A:75, B:65, C:50, U:0"
  const bands = v.bands.split(",").map((p) => {
    const [g, m] = p.split(":").map((x) => x.trim());
    const min = Number(m);
    if (!g || !Number.isFinite(min) || min < 0 || min > 100) throw new UserError(`Could not read band "${p.trim()}". Use GRADE:MIN, e.g. A:75.`);
    return { grade: g.slice(0, 4), min };
  });
  bands.sort((a, b) => b.min - a.min);
  if (bands.at(-1)?.min !== 0) throw new UserError("The lowest band must start at 0.");
  await ctx.db.update(gradingScale).set({ bands }).where(eq(gradingScale.id, v.id));
  await recordSchoolAudit(ctx.db, ctx, "settings.grading_scale.updated", { type: "grading_scale", id: v.id }, { bands });
}

export function gradeFor(bands: { grade: string; min: number }[], percent: number): string {
  return [...bands].sort((a, b) => b.min - a.min).find((b) => percent >= b.min)?.grade ?? "U";
}

// ------------------------------------------------------------------ access helpers
async function groupOf(ctx: SchoolContext, groupId: string) {
  const [g] = await ctx.db.select().from(teachingGroup).where(eq(teachingGroup.id, groupId));
  if (!g) throw new UserError("Teaching group not found.");
  return g;
}

/** Teacher of the group, or a manager (settings.manage / marks.approve). */
async function assertTeachesGroup(ctx: SchoolContext, groupId: string) {
  const g = await groupOf(ctx, groupId);
  if (can(ctx, "settings.manage") || can(ctx, "marks.approve")) return g;
  assertCan(ctx, "assessments.manage_own");
  if (!ctx.personId || g.teacherPersonId !== ctx.personId) throw new ForbiddenError("assessments.manage_own");
  return g;
}

async function assessmentWithGroup(ctx: SchoolContext, assessmentId: string) {
  const id = z.string().uuid().parse(assessmentId);
  const [a] = await ctx.db.select().from(assessment).where(eq(assessment.id, id));
  if (!a) throw new UserError("Assessment not found.");
  return a;
}

async function yearClosedForTerm(ctx: SchoolContext, termId: string) {
  const [r] = await ctx.db.select({ s: academicYear.status }).from(term).innerJoin(academicYear, eq(academicYear.id, term.academicYearId)).where(eq(term.id, termId));
  return r?.s === "closed";
}

// ------------------------------------------------------------------ assessments
export async function listAssessments(ctx: SchoolContext, groupId: string, termId?: string) {
  const g = await groupOf(ctx, groupId);
  const staffView = can(ctx, "settings.manage") || can(ctx, "marks.approve") || can(ctx, "reports.view_all") || g.teacherPersonId === ctx.personId;
  if (!staffView) {
    // Students/guardians: only if the student is in the group.
    const me = await myStudentRecord(ctx);
    const inGroup = me ? (await ctx.db.select().from(groupMember).where(and(eq(groupMember.teachingGroupId, groupId), eq(groupMember.studentId, me.id)))).length > 0 : false;
    if (!inGroup) throw new ForbiddenError();
  }
  return ctx.db
    .select({
      a: assessment,
      termName: term.name,
      marked: sql<number>`(select count(*)::int from ${mark} m where m.assessment_id = ${assessment.id} and m.score is not null)`,
      approved: sql<number>`(select count(*)::int from ${mark} m where m.assessment_id = ${assessment.id} and m.status in ('approved','published'))`,
    })
    .from(assessment)
    .innerJoin(term, eq(term.id, assessment.termId))
    .where(and(eq(assessment.teachingGroupId, groupId), termId ? eq(assessment.termId, termId) : undefined))
    .orderBy(desc(assessment.createdAt));
}

const assessmentInput = z.object({
  groupId: z.string().uuid(),
  termId: z.string().uuid(),
  title: z.string().trim().min(2).max(120),
  kind: z.enum(["classwork", "assignment", "test", "exam", "coursework", "cala", "practical"]),
  maxScore: z.coerce.number().positive().max(1000),
  weight: z.coerce.number().min(0).max(100).optional().or(z.literal("").transform(() => undefined)),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  instructions: z.string().trim().max(4000).optional(),
  acceptsSubmissions: z.string().optional(),
});

export async function createAssessment(ctx: SchoolContext, raw: unknown) {
  const v = assessmentInput.parse(raw);
  await assertTeachesGroup(ctx, v.groupId);
  if (await yearClosedForTerm(ctx, v.termId)) throw new UserError("That term belongs to a closed academic year.");
  if (v.weight !== undefined && v.weight > 0) {
    const [{ total } = { total: 0 }] = await ctx.db
      .select({ total: sql<number>`coalesce(sum(${assessment.weight}), 0)::float` })
      .from(assessment)
      .where(and(eq(assessment.teachingGroupId, v.groupId), eq(assessment.termId, v.termId)));
    if (total + v.weight > 100) throw new UserError(`Weights for this term would total ${total + v.weight}%. They cannot exceed 100%.`);
  }
  return ctx.db.transaction(async (tx) => {
    const [a] = await tx
      .insert(assessment)
      .values({ teachingGroupId: v.groupId, termId: v.termId, title: v.title, kind: v.kind, maxScore: v.maxScore, weight: v.weight && v.weight > 0 ? v.weight : null, dueOn: v.dueOn ?? null, instructions: v.instructions || null, acceptsSubmissions: Boolean(v.acceptsSubmissions), createdBy: ctx.user.id })
      .returning({ id: assessment.id });
    // Every student starts as "pending" (never zero).
    const members = await tx.select({ id: groupMember.studentId }).from(groupMember).where(eq(groupMember.teachingGroupId, v.groupId));
    if (members.length) await tx.insert(mark).values(members.map((m) => ({ assessmentId: a!.id, studentId: m.id, status: "pending" as const })));
    await recordSchoolAudit(tx, ctx, "assessment.created", { type: "assessment", id: a!.id });
    if (v.kind === "assignment" || v.acceptsSubmissions) {
      await notify(tx, await studentPersonIds(tx, members.map((m) => m.id)), { title: `New ${v.kind}: ${v.title}`, body: v.dueOn ? `Due ${v.dueOn}` : undefined, source: "assessments", link: `/s/${ctx.school.slug}/learning` });
    }
    return a!;
  });
}

export async function getMarksheet(ctx: SchoolContext, assessmentId: string) {
  const a = await assessmentWithGroup(ctx, assessmentId);
  const g = await assertTeachesGroup(ctx, a.teachingGroupId);
  const members = await groupMembers(ctx, a.teachingGroupId);
  const marks = await ctx.db.select().from(mark).where(eq(mark.assessmentId, a.id));
  const subs = await ctx.db.select({ studentId: submission.studentId, text: submission.text, fileId: submission.fileId, at: submission.submittedAt }).from(submission).where(eq(submission.assessmentId, a.id));
  return {
    assessment: a,
    group: g,
    rows: members.map((m) => {
      const mk = marks.find((x) => x.studentId === m.id);
      return { ...m, score: mk?.score ?? null, status: mk?.status ?? "pending", comment: mk?.comment ?? "", submission: subs.find((s) => s.studentId === m.id) ?? null };
    }),
  };
}

/**
 * Saves scores. Blank = still pending; tick "missing" to record a missing piece of work.
 * Approved/published marks can only be changed by an approver, and the change is audited.
 */
export async function saveMarks(ctx: SchoolContext, values: Record<string, string | string[]>) {
  const a = await assessmentWithGroup(ctx, String(values.assessmentId));
  await assertTeachesGroup(ctx, a.teachingGroupId);
  if (await yearClosedForTerm(ctx, a.termId)) throw new UserError("This academic year is closed. Corrections must go through the headmaster.");
  const members = await groupMembers(ctx, a.teachingGroupId);
  const existing = await ctx.db.select().from(mark).where(eq(mark.assessmentId, a.id));
  const changes: { studentId: string; from: number | null; to: number | null }[] = [];
  await ctx.db.transaction(async (tx) => {
    for (const m of members) {
      const raw = String(values[`score_${m.id}`] ?? "").trim();
      const missing = Boolean(values[`missing_${m.id}`]);
      const comment = String(values[`comment_${m.id}`] ?? "").slice(0, 300) || null;
      const prev = existing.find((x) => x.studentId === m.id);
      let score: number | null = null;
      if (raw !== "") {
        score = Number(raw);
        if (!Number.isFinite(score) || score < 0 || score > a.maxScore) throw new UserError(`Score for ${m.firstName} ${m.lastName} must be between 0 and ${a.maxScore}.`);
      }
      const locked = prev && (prev.status === "approved" || prev.status === "published");
      if (locked && (prev.score ?? null) !== score) {
        if (!can(ctx, "marks.approve")) throw new UserError(`${m.firstName} ${m.lastName}'s mark is already approved. Ask the headmaster to correct it.`);
        changes.push({ studentId: m.id, from: prev.score, to: score });
      }
      const status = locked ? prev.status : score !== null ? "marked" : missing ? "missing" : prev?.status === "submitted" ? "submitted" : "pending";
      await tx
        .insert(mark)
        .values({ assessmentId: a.id, studentId: m.id, score, status, comment, enteredBy: ctx.user.id, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [mark.assessmentId, mark.studentId], set: { score, status, comment, enteredBy: ctx.user.id, updatedAt: new Date() } });
    }
    await recordSchoolAudit(tx, ctx, changes.length ? "marks.corrected_after_approval" : "marks.saved", { type: "assessment", id: a.id }, changes.length ? { changes } : { students: members.length });
  });
}

/** Approver moves marked → approved, then approved → published (visible to students/parents). */
export async function advanceMarks(ctx: SchoolContext, assessmentId: string, to: "approved" | "published") {
  assertCan(ctx, "marks.approve");
  const a = await assessmentWithGroup(ctx, assessmentId);
  const from = to === "approved" ? ["marked"] : ["approved"];
  const updated = await ctx.db
    .update(mark)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(mark.assessmentId, a.id), inArray(mark.status, from as ("marked" | "approved")[])))
    .returning({ studentId: mark.studentId });
  await recordSchoolAudit(ctx.db, ctx, `marks.${to}`, { type: "assessment", id: a.id }, { count: updated.length });
  if (to === "published" && updated.length) {
    await notify(ctx.db, await studentPersonIds(ctx.db, updated.map((u) => u.studentId)), { title: `Results published: ${a.title}`, source: "assessments", link: `/s/${ctx.school.slug}/learning` });
  }
  return updated.length;
}

/**
 * Term result per subject for one student: weighted percentage over assessments that have
 * a score. Missing/pending weighted work makes the result "incomplete" (never treated as 0).
 * Students and parents see only PUBLISHED marks.
 */
export async function studentResults(ctx: SchoolContext, studentId: string, termId: string) {
  await requireVisibleStudent(ctx, studentId);
  const staffView = can(ctx, "students.view_all") || can(ctx, "students.view_taught");
  const groups = await ctx.db
    .select({ groupId: teachingGroup.id, groupName: teachingGroup.name, subjectName: subject.name, board: subject.examBoard, tFirst: person.firstName, tLast: person.lastName })
    .from(groupMember)
    .innerJoin(teachingGroup, eq(teachingGroup.id, groupMember.teachingGroupId))
    .innerJoin(subject, eq(subject.id, teachingGroup.subjectId))
    .leftJoin(person, eq(person.id, teachingGroup.teacherPersonId))
    .where(eq(groupMember.studentId, studentId))
    .orderBy(asc(subject.name));
  const scales = await listScales(ctx);
  const out = [];
  for (const g of groups) {
    const rows = await ctx.db
      .select({ title: assessment.title, kind: assessment.kind, max: assessment.maxScore, weight: assessment.weight, score: mark.score, status: mark.status, comment: mark.comment })
      .from(assessment)
      .leftJoin(mark, and(eq(mark.assessmentId, assessment.id), eq(mark.studentId, studentId)))
      .where(and(eq(assessment.teachingGroupId, g.groupId), eq(assessment.termId, termId)))
      .orderBy(asc(assessment.createdAt));
    const visible = staffView ? rows : rows.filter((r) => r.status === "published");
    const weighted = visible.filter((r) => r.weight);
    const scored = weighted.filter((r) => r.score !== null && r.score !== undefined);
    const wsum = scored.reduce((s, r) => s + Number(r.weight), 0);
    const percent = wsum > 0 ? Math.round((scored.reduce((s, r) => s + (Number(r.score) / Number(r.max)) * Number(r.weight), 0) / wsum) * 1000) / 10 : null;
    const scale = scales.find((s) => s.examBoard === g.board) ?? scales[0];
    out.push({
      subject: g.subjectName,
      group: g.groupName,
      teacher: g.tFirst ? `${g.tFirst} ${g.tLast}` : null,
      assessments: visible,
      percent,
      grade: percent !== null && scale ? gradeFor(scale.bands, percent) : null,
      incomplete: weighted.length > scored.length,
      weightCovered: wsum,
    });
  }
  return out;
}

// ------------------------------------------------------------------ submissions and materials
export async function submitWork(ctx: SchoolContext, assessmentId: string, text: string, file: File | null) {
  const me = await myStudentRecord(ctx);
  if (!me) throw new ForbiddenError("portal.student");
  const a = await assessmentWithGroup(ctx, assessmentId);
  if (!a.acceptsSubmissions) throw new UserError("This assessment does not accept online submissions.");
  if (a.status === "closed") throw new UserError("Submissions are closed.");
  const inGroup = await ctx.db.select().from(groupMember).where(and(eq(groupMember.teachingGroupId, a.teachingGroupId), eq(groupMember.studentId, me.id)));
  if (!inGroup.length) throw new ForbiddenError();
  const body = z.string().trim().max(10_000).parse(text);
  const fileId = await storeUpload(ctx, file, "submission");
  if (!body && !fileId) throw new UserError("Write an answer or attach a file.");
  await ctx.db
    .insert(submission)
    .values({ assessmentId: a.id, studentId: me.id, text: body || null, fileId })
    .onConflictDoUpdate({ target: [submission.assessmentId, submission.studentId], set: { text: body || null, fileId, submittedAt: new Date() } });
  await ctx.db.update(mark).set({ status: "submitted", updatedAt: new Date() }).where(and(eq(mark.assessmentId, a.id), eq(mark.studentId, me.id), inArray(mark.status, ["pending", "missing"])));
  await recordSchoolAudit(ctx.db, ctx, "submission.made", { type: "assessment", id: a.id });
}

export async function addMaterial(ctx: SchoolContext, raw: { groupId: string; title: string; description?: string; link?: string }, file: File | null) {
  await assertTeachesGroup(ctx, z.string().uuid().parse(raw.groupId));
  const title = z.string().trim().min(2).max(160).parse(raw.title);
  const link = raw.link?.trim() ? z.string().url().refine((u) => u.startsWith("https://"), "links must start with https://").parse(raw.link.trim()) : null;
  const fileId = await storeUpload(ctx, file, "material");
  if (!fileId && !link) throw new UserError("Attach a file or give a link.");
  await ctx.db.insert(learningMaterial).values({ teachingGroupId: raw.groupId, title, description: raw.description?.slice(0, 2000) || null, fileId, link, createdBy: ctx.user.id });
  const members = await ctx.db.select({ id: groupMember.studentId }).from(groupMember).where(eq(groupMember.teachingGroupId, raw.groupId));
  await notify(ctx.db, await studentPersonIds(ctx.db, members.map((m) => m.id)), { title: `New learning material: ${title}`, source: "materials", link: `/s/${ctx.school.slug}/learning` });
}

/** Student portal: my groups, their materials, and assessments (with my published marks). */
export async function myLearning(ctx: SchoolContext) {
  const me = await myStudentRecord(ctx);
  if (!me) return null;
  const groups = await ctx.db
    .select({ id: teachingGroup.id, name: teachingGroup.name, subject: subject.name })
    .from(groupMember)
    .innerJoin(teachingGroup, eq(teachingGroup.id, groupMember.teachingGroupId))
    .innerJoin(subject, eq(subject.id, teachingGroup.subjectId))
    .where(eq(groupMember.studentId, me.id))
    .orderBy(asc(subject.name));
  const ids = groups.map((g) => g.id);
  const materials = ids.length
    ? await ctx.db.select({ m: learningMaterial, fileName: fileObject.originalName }).from(learningMaterial).leftJoin(fileObject, eq(fileObject.id, learningMaterial.fileId)).where(inArray(learningMaterial.teachingGroupId, ids)).orderBy(desc(learningMaterial.createdAt))
    : [];
  const work = ids.length
    ? await ctx.db
        .select({ a: assessment, status: mark.status, score: mark.score, submittedAt: submission.submittedAt })
        .from(assessment)
        .leftJoin(mark, and(eq(mark.assessmentId, assessment.id), eq(mark.studentId, me.id)))
        .leftJoin(submission, and(eq(submission.assessmentId, assessment.id), eq(submission.studentId, me.id)))
        .where(and(inArray(assessment.teachingGroupId, ids), isNotNull(assessment.id)))
        .orderBy(desc(assessment.createdAt))
        .limit(100)
    : [];
  return {
    student: me,
    groups,
    materials,
    work: work.map((w) => ({ ...w, score: w.status === "published" ? w.score : null })),
  };
}

export async function groupMaterials(ctx: SchoolContext, groupId: string) {
  await assertTeachesGroup(ctx, groupId);
  return ctx.db.select({ m: learningMaterial, fileName: fileObject.originalName }).from(learningMaterial).leftJoin(fileObject, eq(fileObject.id, learningMaterial.fileId)).where(eq(learningMaterial.teachingGroupId, groupId)).orderBy(desc(learningMaterial.createdAt));
}

export { assertTeachesGroup };
