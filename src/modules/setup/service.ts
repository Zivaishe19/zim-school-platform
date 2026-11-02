import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import {
  academicYear,
  enrolment,
  form,
  groupMember,
  period,
  person,
  room,
  schoolClass,
  schoolProfile,
  student,
  subject,
  teachingGroup,
  term,
} from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { assertCan, type SchoolContext } from "@/server/tenancy/context";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const name = z.string().trim().min(1).max(120);

export const FORM_NAMES: Record<number, string> = { 1: "Form 1", 2: "Form 2", 3: "Form 3", 4: "Form 4", 5: "Lower Six", 6: "Upper Six" };

// ------------------------------------------------------------------ reads (any member)
export async function getProfile(ctx: SchoolContext) {
  const [p] = await ctx.db.select().from(schoolProfile).limit(1);
  return p ?? { id: 1, displayName: ctx.school.name, motto: null, address: null, phone: null, email: null, defaultCurrency: "USD", studentLoanLimit: 1, staffLoanLimit: 5, loanDays: 14, updatedAt: new Date() };
}

export async function listYears(ctx: SchoolContext) {
  return ctx.db.select().from(academicYear).orderBy(desc(academicYear.startsOn));
}

/** The open year, else the most recent one. */
export async function currentYear(ctx: SchoolContext) {
  const years = await listYears(ctx);
  return years.find((y) => y.status === "open") ?? years[0] ?? null;
}

export async function listTerms(ctx: SchoolContext, yearId?: string) {
  const q = ctx.db.select().from(term);
  return (yearId ? q.where(eq(term.academicYearId, yearId)) : q).orderBy(asc(term.startsOn));
}

export async function currentTerm(ctx: SchoolContext) {
  const terms = await listTerms(ctx);
  return terms.find((t) => t.status === "open") ?? terms.at(-1) ?? null;
}

export async function listForms(ctx: SchoolContext) {
  return ctx.db.select().from(form).orderBy(asc(form.level));
}

export async function listRooms(ctx: SchoolContext) {
  return ctx.db.select().from(room).orderBy(asc(room.name));
}

export async function listSubjects(ctx: SchoolContext) {
  return ctx.db.select().from(subject).orderBy(asc(subject.name));
}

export async function listClasses(ctx: SchoolContext, yearId?: string) {
  const rows = await ctx.db
    .select({
      id: schoolClass.id,
      name: schoolClass.name,
      stream: schoolClass.stream,
      academicYearId: schoolClass.academicYearId,
      formLevel: form.level,
      formName: form.name,
      roomName: room.name,
      classTeacherPersonId: schoolClass.classTeacherPersonId,
      teacherFirst: person.firstName,
      teacherLast: person.lastName,
      size: sql<number>`(select count(*)::int from ${enrolment} e where e.class_id = ${schoolClass.id} and e.status = 'active')`,
    })
    .from(schoolClass)
    .innerJoin(form, eq(form.id, schoolClass.formId))
    .leftJoin(room, eq(room.id, schoolClass.roomId))
    .leftJoin(person, eq(person.id, schoolClass.classTeacherPersonId))
    .where(yearId ? eq(schoolClass.academicYearId, yearId) : undefined)
    .orderBy(asc(form.level), asc(schoolClass.name));
  return rows;
}

export async function listGroups(ctx: SchoolContext, opts: { yearId?: string; teacherPersonId?: string } = {}) {
  return ctx.db
    .select({
      id: teachingGroup.id,
      name: teachingGroup.name,
      academicYearId: teachingGroup.academicYearId,
      subjectId: subject.id,
      subjectName: subject.name,
      subjectCode: subject.code,
      examBoard: subject.examBoard,
      formLevel: form.level,
      classId: teachingGroup.classId,
      teacherPersonId: teachingGroup.teacherPersonId,
      teacherFirst: person.firstName,
      teacherLast: person.lastName,
      size: sql<number>`(select count(*)::int from ${groupMember} gm where gm.teaching_group_id = ${teachingGroup.id})`,
    })
    .from(teachingGroup)
    .innerJoin(subject, eq(subject.id, teachingGroup.subjectId))
    .leftJoin(form, eq(form.id, teachingGroup.formId))
    .leftJoin(person, eq(person.id, teachingGroup.teacherPersonId))
    .where(
      and(
        opts.yearId ? eq(teachingGroup.academicYearId, opts.yearId) : undefined,
        opts.teacherPersonId ? eq(teachingGroup.teacherPersonId, opts.teacherPersonId) : undefined,
      ),
    )
    .orderBy(asc(subject.name), asc(teachingGroup.name));
}

export async function classMembers(ctx: SchoolContext, classId: string) {
  return ctx.db
    .select({ id: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber })
    .from(enrolment)
    .innerJoin(student, eq(student.id, enrolment.studentId))
    .where(and(eq(enrolment.classId, classId), eq(enrolment.status, "active")))
    .orderBy(asc(student.lastName), asc(student.firstName));
}

export async function groupMembers(ctx: SchoolContext, groupId: string) {
  return ctx.db
    .select({ id: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber })
    .from(groupMember)
    .innerJoin(student, eq(student.id, groupMember.studentId))
    .where(eq(groupMember.teachingGroupId, groupId))
    .orderBy(asc(student.lastName), asc(student.firstName));
}

export async function listPeriods(ctx: SchoolContext) {
  return ctx.db.select().from(period).orderBy(asc(period.weekday), asc(period.number));
}

/** Current active class of a student (for report cards, duties...). */
export async function currentClassOf(ctx: SchoolContext, studentId: string) {
  const [row] = await ctx.db
    .select({ classId: enrolment.classId, className: schoolClass.name, yearId: enrolment.academicYearId, formLevel: form.level })
    .from(enrolment)
    .innerJoin(schoolClass, eq(schoolClass.id, enrolment.classId))
    .innerJoin(form, eq(form.id, schoolClass.formId))
    .innerJoin(academicYear, eq(academicYear.id, enrolment.academicYearId))
    .where(and(eq(enrolment.studentId, studentId), eq(enrolment.status, "active")))
    .orderBy(desc(academicYear.startsOn))
    .limit(1);
  return row ?? null;
}

// ------------------------------------------------------------------ writes (settings.manage)
export async function saveProfile(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z
    .object({
      displayName: name,
      motto: z.string().trim().max(200).optional(),
      address: z.string().trim().max(300).optional(),
      phone: z.string().trim().max(40).optional(),
      email: z.string().trim().max(120).optional(),
      defaultCurrency: z.enum(["USD", "ZiG"]),
      studentLoanLimit: z.coerce.number().int().min(0).max(20),
      staffLoanLimit: z.coerce.number().int().min(0).max(50),
      loanDays: z.coerce.number().int().min(1).max(120),
    })
    .parse(raw);
  await ctx.db
    .insert(schoolProfile)
    .values({ id: 1, ...v, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schoolProfile.id, set: { ...v, updatedAt: new Date() } });
  await recordSchoolAudit(ctx.db, ctx, "settings.profile.updated", { type: "school_profile", id: "1" });
}

export async function createYear(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z.object({ name: name, startsOn: isoDate, endsOn: isoDate, terms: z.coerce.number().int().min(0).max(4).default(3) }).parse(raw);
  if (v.endsOn <= v.startsOn) throw new UserError("The year must end after it starts.");
  return ctx.db.transaction(async (tx) => {
    const [y] = await tx.insert(academicYear).values({ name: v.name, startsOn: v.startsOn, endsOn: v.endsOn }).returning();
    // Default: equal terms; dates can be edited afterwards.
    const start = Date.parse(v.startsOn);
    const span = (Date.parse(v.endsOn) - start) / Math.max(v.terms, 1);
    for (let i = 0; i < v.terms; i++) {
      const s = new Date(start + span * i).toISOString().slice(0, 10);
      const e = new Date(start + span * (i + 1) - 86_400_000).toISOString().slice(0, 10);
      await tx.insert(term).values({ academicYearId: y!.id, number: i + 1, name: `Term ${i + 1}`, startsOn: s, endsOn: i === v.terms - 1 ? v.endsOn : e });
    }
    await recordSchoolAudit(tx, ctx, "settings.year.created", { type: "academic_year", id: y!.id });
    return y!;
  });
}

/** Only one year and one term may be open at a time. Closing is done by year closure (reports module). */
export async function openYear(ctx: SchoolContext, yearId: string) {
  assertCan(ctx, "settings.manage");
  await ctx.db.transaction(async (tx) => {
    const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, yearId));
    if (!y) throw new UserError("Year not found.");
    if (y.status === "closed") throw new UserError("A closed year cannot be reopened. Use controlled corrections instead.");
    await tx.update(academicYear).set({ status: "planned" }).where(eq(academicYear.status, "open"));
    await tx.update(academicYear).set({ status: "open" }).where(eq(academicYear.id, yearId));
    await recordSchoolAudit(tx, ctx, "settings.year.opened", { type: "academic_year", id: yearId });
  });
}

export async function updateTerm(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z.object({ termId: z.string().uuid(), name: name, startsOn: isoDate, endsOn: isoDate, open: z.string().optional() }).parse(raw);
  await ctx.db.transaction(async (tx) => {
    if (v.open) await tx.update(term).set({ status: "closed" }).where(eq(term.status, "open"));
    await tx
      .update(term)
      .set({ name: v.name, startsOn: v.startsOn, endsOn: v.endsOn, ...(v.open ? { status: "open" as const } : {}) })
      .where(eq(term.id, v.termId));
    await recordSchoolAudit(tx, ctx, "settings.term.updated", { type: "term", id: v.termId }, { open: Boolean(v.open) });
  });
}

export async function setForms(ctx: SchoolContext, levels: number[]) {
  assertCan(ctx, "settings.manage");
  const wanted = levels.filter((l) => l >= 1 && l <= 6);
  if (!wanted.length) throw new UserError("Choose at least one form.");
  for (const level of wanted) {
    await ctx.db.insert(form).values({ level, name: FORM_NAMES[level]! }).onConflictDoNothing();
  }
  await recordSchoolAudit(ctx.db, ctx, "settings.forms.updated", { type: "form", id: wanted.join(",") });
}

export async function createRoom(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z.object({ name: name, capacity: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(2000).optional()), kind: z.string().trim().min(1).max(40).default("classroom") }).parse(raw);
  await ctx.db.insert(room).values({ name: v.name, kind: v.kind, capacity: v.capacity ?? null });
}

export async function createSubject(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z
    .object({ code: z.string().trim().min(1).max(20), name: name, examBoard: z.enum(["zimsec", "cambridge", "internal"]), isPractical: z.string().optional() })
    .parse(raw);
  const exists = await ctx.db.select({ id: subject.id }).from(subject).where(and(eq(subject.code, v.code), eq(subject.examBoard, v.examBoard)));
  if (exists.length) throw new UserError("That subject code already exists for this exam board.");
  await ctx.db.insert(subject).values({ code: v.code, name: v.name, examBoard: v.examBoard, isPractical: Boolean(v.isPractical) });
}

export async function createClass(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z
    .object({ academicYearId: z.string().uuid(), formId: z.string().uuid(), name: name, stream: z.string().trim().max(40).optional(), roomId: optUuid, classTeacherPersonId: optUuid })
    .parse(raw);
  const dupe = await ctx.db.select({ id: schoolClass.id }).from(schoolClass).where(and(eq(schoolClass.academicYearId, v.academicYearId), eq(schoolClass.name, v.name)));
  if (dupe.length) throw new UserError("A class with that name already exists this year.");
  const [c] = await ctx.db.insert(schoolClass).values({ ...v, stream: v.stream || null }).returning({ id: schoolClass.id });
  await recordSchoolAudit(ctx.db, ctx, "settings.class.created", { type: "class", id: c!.id });
  return c!;
}

export async function updateClass(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z.object({ classId: z.string().uuid(), roomId: optUuid, classTeacherPersonId: optUuid }).parse(raw);
  await ctx.db.update(schoolClass).set({ roomId: v.roomId ?? null, classTeacherPersonId: v.classTeacherPersonId ?? null }).where(eq(schoolClass.id, v.classId));
  await recordSchoolAudit(ctx.db, ctx, "settings.class.updated", { type: "class", id: v.classId }, { classTeacher: v.classTeacherPersonId ?? null });
}

/** Places students in a class for its year (one active enrolment per student per year). */
export async function enrolStudents(ctx: SchoolContext, classId: string, studentIds: string[]) {
  assertCan(ctx, "settings.manage");
  const [c] = await ctx.db.select().from(schoolClass).where(eq(schoolClass.id, classId));
  if (!c) throw new UserError("Class not found.");
  const ids = z.array(z.string().uuid()).parse(studentIds);
  if (!ids.length) throw new UserError("Choose at least one student.");
  await ctx.db.transaction(async (tx) => {
    for (const sid of ids) {
      await tx
        .insert(enrolment)
        .values({ studentId: sid, academicYearId: c.academicYearId, classId, status: "active" })
        .onConflictDoUpdate({ target: [enrolment.studentId, enrolment.academicYearId], set: { classId, status: "active" } });
    }
    await tx.update(student).set({ status: "enrolled", updatedAt: new Date() }).where(inArray(student.id, ids));
    await recordSchoolAudit(tx, ctx, "enrolment.placed", { type: "class", id: classId }, { students: ids.length });
  });
}

export async function createGroup(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z
    .object({ academicYearId: z.string().uuid(), subjectId: z.string().uuid(), name: name, formId: optUuid, classId: optUuid, teacherPersonId: optUuid, addClassMembers: z.string().optional() })
    .parse(raw);
  return ctx.db.transaction(async (tx) => {
    const [g] = await tx
      .insert(teachingGroup)
      .values({ academicYearId: v.academicYearId, subjectId: v.subjectId, name: v.name, formId: v.formId ?? null, classId: v.classId ?? null, teacherPersonId: v.teacherPersonId ?? null })
      .returning({ id: teachingGroup.id });
    // Common classroom subject: whole class is the group.
    if (v.classId && v.addClassMembers) {
      const members = await tx.select({ id: enrolment.studentId }).from(enrolment).where(and(eq(enrolment.classId, v.classId), eq(enrolment.status, "active")));
      if (members.length) await tx.insert(groupMember).values(members.map((m) => ({ teachingGroupId: g!.id, studentId: m.id }))).onConflictDoNothing();
    }
    await recordSchoolAudit(tx, ctx, "settings.group.created", { type: "teaching_group", id: g!.id });
    return g!;
  });
}

export async function updateGroup(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z.object({ groupId: z.string().uuid(), teacherPersonId: optUuid }).parse(raw);
  await ctx.db.update(teachingGroup).set({ teacherPersonId: v.teacherPersonId ?? null }).where(eq(teachingGroup.id, v.groupId));
  await recordSchoolAudit(ctx.db, ctx, "settings.group.teacher_assigned", { type: "teaching_group", id: v.groupId }, { teacher: v.teacherPersonId ?? null });
}

/** Individual subject selections / practical groups: add or remove students. */
export async function setGroupMembers(ctx: SchoolContext, groupId: string, add: string[], remove: string[]) {
  assertCan(ctx, "settings.manage");
  const a = z.array(z.string().uuid()).parse(add);
  const r = z.array(z.string().uuid()).parse(remove);
  await ctx.db.transaction(async (tx) => {
    if (a.length) await tx.insert(groupMember).values(a.map((studentId) => ({ teachingGroupId: groupId, studentId }))).onConflictDoNothing();
    if (r.length) await tx.delete(groupMember).where(and(eq(groupMember.teachingGroupId, groupId), inArray(groupMember.studentId, r)));
    await recordSchoolAudit(tx, ctx, "settings.group.members_changed", { type: "teaching_group", id: groupId }, { added: a.length, removed: r.length });
  });
}

export async function createPeriods(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const v = z
    .object({
      weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1),
      number: z.coerce.number().int().min(0).max(20),
      label: z.string().trim().min(1).max(40),
      startsAt: z.string().regex(/^\d{2}:\d{2}$/),
      endsAt: z.string().regex(/^\d{2}:\d{2}$/),
      kind: z.enum(["lesson", "break", "lunch", "assembly", "other"]),
    })
    .parse(raw);
  if (v.endsAt <= v.startsAt) throw new UserError("A period must end after it starts.");
  for (const weekday of v.weekdays) {
    await ctx.db
      .insert(period)
      .values({ weekday, number: v.number, label: v.label, startsAt: v.startsAt, endsAt: v.endsAt, kind: v.kind })
      .onConflictDoUpdate({ target: [period.weekday, period.number], set: { label: v.label, startsAt: v.startsAt, endsAt: v.endsAt, kind: v.kind } });
  }
}
