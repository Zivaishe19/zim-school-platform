import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import {
  activity,
  activityMember,
  announcement,
  enrolment,
  event,
  groupMember,
  message,
  messageThread,
  notification,
  person,
  personRole,
  schoolClass,
  student,
  studentGuardian,
  teachingGroup,
  type Audience,
} from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { isStaff, STAFF_ROLES } from "@/server/rbac/roles";
import { assertCan, can, ForbiddenError, type SchoolContext } from "@/server/tenancy/context";
import { myStudentRecord, requireVisibleStudent } from "@/server/tenancy/scope";
import { notify } from "./notify";

// ------------------------------------------------------------------ audiences
const audienceInput = z.object({
  audienceKind: z.enum(["everyone", "staff", "parents", "students", "form", "class", "group"]),
  audienceIds: z.array(z.string().uuid()).default([]),
});

export function parseAudience(values: Record<string, string | string[]>): Audience {
  const ids = values.audienceIds === undefined ? [] : Array.isArray(values.audienceIds) ? values.audienceIds : [values.audienceIds];
  const v = audienceInput.parse({ audienceKind: values.audienceKind, audienceIds: ids.filter(Boolean) });
  if (["form", "class", "group"].includes(v.audienceKind) && !v.audienceIds.length) throw new UserError("Choose at least one form, class or group.");
  return { kind: v.audienceKind, ids: v.audienceIds };
}

/** Teachers with only announcements.send_own may address their own classes and groups. */
async function assertMayAddress(ctx: SchoolContext, a: Audience) {
  if (can(ctx, "announcements.send") || can(ctx, "events.manage")) return;
  assertCan(ctx, "announcements.send_own");
  if (a.kind !== "class" && a.kind !== "group") throw new ForbiddenError("announcements.send");
  const me = ctx.personId ?? "";
  const owned =
    a.kind === "class"
      ? await ctx.db.select({ id: schoolClass.id }).from(schoolClass).where(and(inArray(schoolClass.id, a.ids ?? []), eq(schoolClass.classTeacherPersonId, me)))
      : await ctx.db.select({ id: teachingGroup.id }).from(teachingGroup).where(and(inArray(teachingGroup.id, a.ids ?? []), eq(teachingGroup.teacherPersonId, me)));
  if (owned.length !== (a.ids ?? []).length) throw new ForbiddenError("announcements.send");
}

/** Person ids an audience reaches (students' guardians are included for class/form/group). */
export async function resolveAudience(ctx: SchoolContext, a: Audience): Promise<string[]> {
  const db = ctx.db;
  const withRoles = async (roles: string[]) => (await db.select({ id: personRole.personId }).from(personRole).where(inArray(personRole.roleKey, roles))).map((r) => r.id);
  if (a.kind === "everyone") return (await db.select({ id: person.id }).from(person)).map((r) => r.id);
  if (a.kind === "staff") return withRoles([...STAFF_ROLES]);
  if (a.kind === "parents") return withRoles(["parent"]);
  if (a.kind === "students") return withRoles(["student"]);
  if (a.kind === "people") return a.ids ?? [];
  let studentIds: string[] = [];
  if (a.kind === "class") {
    studentIds = (await db.select({ id: enrolment.studentId }).from(enrolment).where(and(inArray(enrolment.classId, a.ids ?? []), eq(enrolment.status, "active")))).map((r) => r.id);
  } else if (a.kind === "form") {
    studentIds = (
      await db.select({ id: enrolment.studentId }).from(enrolment).innerJoin(schoolClass, eq(schoolClass.id, enrolment.classId)).where(and(inArray(schoolClass.formId, a.ids ?? []), eq(enrolment.status, "active")))
    ).map((r) => r.id);
  } else if (a.kind === "group") {
    studentIds = (await db.select({ id: groupMember.studentId }).from(groupMember).where(inArray(groupMember.teachingGroupId, a.ids ?? []))).map((r) => r.id);
  }
  if (!studentIds.length) return [];
  const learners = (await db.select({ id: student.personId }).from(student).where(inArray(student.id, studentIds))).map((r) => r.id).filter((x): x is string => Boolean(x));
  const guardians = (await db.select({ id: studentGuardian.guardianPersonId }).from(studentGuardian).where(inArray(studentGuardian.studentId, studentIds))).map((r) => r.id);
  return [...learners, ...guardians];
}

/** What audiences the current user belongs to (for showing announcements/events). */
async function myAudienceKeys(ctx: SchoolContext) {
  const me = ctx.personId;
  const staff = isStaff(ctx.roles);
  const studentIds: string[] = [];
  const self = await myStudentRecord(ctx);
  if (self) studentIds.push(self.id);
  if (me) studentIds.push(...(await ctx.db.select({ id: studentGuardian.studentId }).from(studentGuardian).where(eq(studentGuardian.guardianPersonId, me))).map((r) => r.id));
  const classRows = studentIds.length
    ? await ctx.db.select({ classId: enrolment.classId, formId: schoolClass.formId }).from(enrolment).innerJoin(schoolClass, eq(schoolClass.id, enrolment.classId)).where(and(inArray(enrolment.studentId, studentIds), eq(enrolment.status, "active")))
    : [];
  const groupRows = studentIds.length ? await ctx.db.select({ id: groupMember.teachingGroupId }).from(groupMember).where(inArray(groupMember.studentId, studentIds)) : [];
  const taughtGroups = me ? await ctx.db.select({ id: teachingGroup.id }).from(teachingGroup).where(eq(teachingGroup.teacherPersonId, me)) : [];
  const ledClasses = me ? await ctx.db.select({ id: schoolClass.id, formId: schoolClass.formId }).from(schoolClass).where(eq(schoolClass.classTeacherPersonId, me)) : [];
  return {
    me,
    staff,
    parent: ctx.roles.includes("parent"),
    student: ctx.roles.includes("student"),
    classIds: new Set([...classRows.map((r) => r.classId), ...ledClasses.map((c) => c.id)]),
    formIds: new Set([...classRows.map((r) => r.formId), ...ledClasses.map((c) => c.formId)]),
    groupIds: new Set([...groupRows.map((r) => r.id), ...taughtGroups.map((g) => g.id)]),
  };
}

function matches(keys: Awaited<ReturnType<typeof myAudienceKeys>>, a: Audience, authorId?: string | null): boolean {
  if (authorId && authorId === keys.me) return true;
  switch (a.kind) {
    case "everyone": return true;
    case "staff": return keys.staff;
    case "parents": return keys.parent;
    case "students": return keys.student;
    case "class": return (a.ids ?? []).some((i) => keys.classIds.has(i));
    case "form": return (a.ids ?? []).some((i) => keys.formIds.has(i));
    case "group": return (a.ids ?? []).some((i) => keys.groupIds.has(i));
    case "people": return Boolean(keys.me && (a.ids ?? []).includes(keys.me));
  }
}

// ------------------------------------------------------------------ announcements
export async function sendAnnouncement(ctx: SchoolContext, values: Record<string, string | string[]>) {
  const v = z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(5000) }).parse(values);
  const audience = parseAudience(values);
  await assertMayAddress(ctx, audience);
  const [a] = await ctx.db.insert(announcement).values({ title: v.title, body: v.body, audience, authorPersonId: ctx.personId }).returning({ id: announcement.id });
  const recipients = (await resolveAudience(ctx, audience)).filter((id) => id !== ctx.personId);
  const n = await notify(ctx.db, recipients, { title: v.title, body: v.body.slice(0, 300), source: "announcement", link: `/s/${ctx.school.slug}/announcements`, senderPersonId: ctx.personId });
  await recordSchoolAudit(ctx.db, ctx, "announcement.sent", { type: "announcement", id: a!.id }, { audience, recipients: n });
  return n;
}

export async function myAnnouncements(ctx: SchoolContext, limit = 50) {
  const keys = await myAudienceKeys(ctx);
  const rows = await ctx.db
    .select({ a: announcement, first: person.firstName, last: person.lastName })
    .from(announcement)
    .leftJoin(person, eq(person.id, announcement.authorPersonId))
    .orderBy(desc(announcement.createdAt))
    .limit(300);
  return rows.filter((r) => matches(keys, r.a.audience, r.a.authorPersonId)).slice(0, limit);
}

// ------------------------------------------------------------------ notifications
export async function myNotifications(ctx: SchoolContext, limit = 50) {
  if (!ctx.personId) return [];
  return ctx.db.select().from(notification).where(eq(notification.recipientPersonId, ctx.personId)).orderBy(desc(notification.createdAt)).limit(limit);
}

export async function unreadCount(ctx: SchoolContext) {
  if (!ctx.personId) return 0;
  const [r] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(notification).where(and(eq(notification.recipientPersonId, ctx.personId), isNull(notification.readAt)));
  return r?.n ?? 0;
}

export async function markAllRead(ctx: SchoolContext) {
  if (!ctx.personId) return;
  await ctx.db.update(notification).set({ readAt: new Date() }).where(and(eq(notification.recipientPersonId, ctx.personId), isNull(notification.readAt)));
}

// ------------------------------------------------------------------ structured messages
export const MESSAGE_CATEGORIES = ["absence_explanation", "academic_concern", "meeting_request", "discipline", "document_request", "fees", "general"] as const;

/** Staff a guardian may write to about a child: class teacher, subject teachers, headmaster, accounts. */
export async function contactableStaff(ctx: SchoolContext, studentId: string) {
  await requireVisibleStudent(ctx, studentId);
  const ct = await ctx.db
    .select({ id: person.id, first: person.firstName, last: person.lastName })
    .from(enrolment)
    .innerJoin(schoolClass, eq(schoolClass.id, enrolment.classId))
    .innerJoin(person, eq(person.id, schoolClass.classTeacherPersonId))
    .where(and(eq(enrolment.studentId, studentId), eq(enrolment.status, "active")));
  const st = await ctx.db
    .select({ id: person.id, first: person.firstName, last: person.lastName, subject: teachingGroup.name })
    .from(groupMember)
    .innerJoin(teachingGroup, eq(teachingGroup.id, groupMember.teachingGroupId))
    .innerJoin(person, eq(person.id, teachingGroup.teacherPersonId))
    .where(eq(groupMember.studentId, studentId));
  const office = await ctx.db
    .select({ id: person.id, first: person.firstName, last: person.lastName, role: personRole.roleKey })
    .from(personRole)
    .innerJoin(person, eq(person.id, personRole.personId))
    .where(inArray(personRole.roleKey, ["headmaster", "accounts"]));
  const out = new Map<string, string>();
  for (const c of ct) out.set(c.id, `${c.first} ${c.last} (class teacher)`);
  for (const s of st) if (!out.has(s.id)) out.set(s.id, `${s.first} ${s.last} (${s.subject})`);
  for (const o of office) if (!out.has(o.id)) out.set(o.id, `${o.first} ${o.last} (${o.role === "headmaster" ? "Headmaster" : "Accounts"})`);
  return [...out.entries()].map(([id, label]) => ({ id, label }));
}

const threadInput = z.object({
  studentId: z.string().uuid(),
  category: z.enum(MESSAGE_CATEGORIES),
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(2).max(1000),
  staffPersonId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  guardianPersonId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
});

export async function startThread(ctx: SchoolContext, raw: unknown) {
  const v = threadInput.parse(raw);
  if (!ctx.personId) throw new ForbiddenError();
  await requireVisibleStudent(ctx, v.studentId);
  const isGuardian = (await ctx.db.select().from(studentGuardian).where(and(eq(studentGuardian.studentId, v.studentId), eq(studentGuardian.guardianPersonId, ctx.personId)))).length > 0;
  let guardianId: string, staffId: string;
  if (isGuardian && !can(ctx, "messages.staff")) {
    if (!v.staffPersonId) throw new UserError("Choose who to write to.");
    const allowed = await contactableStaff(ctx, v.studentId);
    if (!allowed.some((a) => a.id === v.staffPersonId)) throw new ForbiddenError();
    guardianId = ctx.personId;
    staffId = v.staffPersonId;
  } else {
    assertCan(ctx, "messages.staff");
    if (!v.guardianPersonId) throw new UserError("Choose the parent or guardian.");
    const linked = await ctx.db.select().from(studentGuardian).where(and(eq(studentGuardian.studentId, v.studentId), eq(studentGuardian.guardianPersonId, v.guardianPersonId)));
    if (!linked.length) throw new UserError("That person is not a guardian of this student.");
    guardianId = v.guardianPersonId;
    staffId = ctx.personId;
  }
  const [t] = await ctx.db.insert(messageThread).values({ category: v.category, subject: v.subject, studentId: v.studentId, guardianPersonId: guardianId, staffPersonId: staffId }).returning({ id: messageThread.id });
  await ctx.db.insert(message).values({ threadId: t!.id, authorPersonId: ctx.personId, body: v.body });
  await notify(ctx.db, [ctx.personId === guardianId ? staffId : guardianId], { title: `New message: ${v.subject}`, source: "messages", link: `/s/${ctx.school.slug}/messages/${t!.id}`, senderPersonId: ctx.personId });
  return t!.id;
}

async function threadForParticipant(ctx: SchoolContext, threadId: string) {
  if (!z.string().uuid().safeParse(threadId).success || !ctx.personId) return null;
  const [t] = await ctx.db.select().from(messageThread).where(and(eq(messageThread.id, threadId), or(eq(messageThread.guardianPersonId, ctx.personId), eq(messageThread.staffPersonId, ctx.personId))));
  return t ?? null;
}

export async function getThread(ctx: SchoolContext, threadId: string) {
  const t = await threadForParticipant(ctx, threadId);
  if (!t) return null;
  const msgs = await ctx.db.select({ m: message, first: person.firstName, last: person.lastName }).from(message).innerJoin(person, eq(person.id, message.authorPersonId)).where(eq(message.threadId, t.id)).orderBy(asc(message.createdAt));
  const [s] = await ctx.db.select({ first: student.firstName, last: student.lastName }).from(student).where(eq(student.id, t.studentId));
  return { thread: t, messages: msgs, student: s };
}

export async function reply(ctx: SchoolContext, threadId: string, body: string) {
  const t = await threadForParticipant(ctx, threadId);
  if (!t) throw new ForbiddenError();
  if (t.status !== "open") throw new UserError("This conversation is closed.");
  const text = z.string().trim().min(1).max(1000).parse(body);
  await ctx.db.insert(message).values({ threadId: t.id, authorPersonId: ctx.personId!, body: text });
  await notify(ctx.db, [ctx.personId === t.guardianPersonId ? t.staffPersonId : t.guardianPersonId], { title: `Reply: ${t.subject}`, source: "messages", link: `/s/${ctx.school.slug}/messages/${t.id}`, senderPersonId: ctx.personId });
}

export async function closeThread(ctx: SchoolContext, threadId: string) {
  const t = await threadForParticipant(ctx, threadId);
  if (!t) throw new ForbiddenError();
  await ctx.db.update(messageThread).set({ status: "closed" }).where(eq(messageThread.id, t.id));
}

export async function myThreads(ctx: SchoolContext) {
  if (!ctx.personId) return [];
  return ctx.db
    .select({ t: messageThread, first: student.firstName, last: student.lastName, last_at: sql<Date>`(select max(created_at) from ${message} m where m.thread_id = ${messageThread.id})` })
    .from(messageThread)
    .innerJoin(student, eq(student.id, messageThread.studentId))
    .where(or(eq(messageThread.guardianPersonId, ctx.personId), eq(messageThread.staffPersonId, ctx.personId)))
    .orderBy(desc(messageThread.createdAt))
    .limit(100);
}

// ------------------------------------------------------------------ events and activities
export const EVENT_KINDS = ["sports_day", "club", "competition", "trip", "parent_meeting", "staff_meeting", "assembly", "exam", "other"] as const;

export async function createEvent(ctx: SchoolContext, values: Record<string, string | string[]>) {
  assertCan(ctx, "events.manage");
  const v = z
    .object({
      title: z.string().trim().min(3).max(160),
      kind: z.enum(EVENT_KINDS),
      startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "date and time required"),
      endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
      location: z.string().trim().max(160).optional(),
      description: z.string().trim().max(3000).optional(),
      notifyAudience: z.string().optional(),
    })
    .parse(values);
  const audience = parseAudience(values);
  const startsAt = new Date(`${v.startsAt}:00Z`);
  const endsAt = v.endsAt ? new Date(`${v.endsAt}:00Z`) : null;
  if (endsAt && endsAt <= startsAt) throw new UserError("The event must end after it starts.");
  const [e] = await ctx.db.insert(event).values({ title: v.title, kind: v.kind, startsAt, endsAt, location: v.location || null, description: v.description || null, audience, createdBy: ctx.user.id }).returning({ id: event.id });
  if (v.notifyAudience) {
    await notify(ctx.db, await resolveAudience(ctx, audience), { title: `Event: ${v.title}`, body: `${v.startsAt.replace("T", " ")}${v.location ? ` · ${v.location}` : ""}`, source: "events", link: `/s/${ctx.school.slug}/events` });
  }
  await recordSchoolAudit(ctx.db, ctx, "event.created", { type: "event", id: e!.id });
}

export async function deleteEvent(ctx: SchoolContext, id: string) {
  assertCan(ctx, "events.manage");
  await ctx.db.delete(event).where(eq(event.id, z.string().uuid().parse(id)));
  await recordSchoolAudit(ctx.db, ctx, "event.deleted", { type: "event", id });
}

export async function upcomingEvents(ctx: SchoolContext, limit = 20) {
  const keys = await myAudienceKeys(ctx);
  const rows = await ctx.db.select().from(event).where(gte(event.startsAt, new Date(Date.now() - 86_400_000))).orderBy(asc(event.startsAt)).limit(300);
  return rows.filter((e) => can(ctx, "events.manage") || matches(keys, e.audience)).slice(0, limit);
}

export async function listActivities(ctx: SchoolContext) {
  return ctx.db
    .select({ a: activity, first: person.firstName, last: person.lastName, members: sql<number>`(select count(*)::int from ${activityMember} m where m.activity_id = ${activity.id} and m.left_on is null)` })
    .from(activity)
    .leftJoin(person, eq(person.id, activity.patronPersonId))
    .orderBy(asc(activity.name));
}

export async function createActivity(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "activities.manage");
  const v = z.object({ name: z.string().trim().min(2).max(80), kind: z.enum(["club", "sport"]), schedule: z.string().trim().max(160).optional(), patronPersonId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)) }).parse(raw);
  await ctx.db.insert(activity).values({ name: v.name, kind: v.kind, schedule: v.schedule || null, patronPersonId: v.patronPersonId ?? null });
}

async function assertManagesActivity(ctx: SchoolContext, activityId: string) {
  if (can(ctx, "activities.manage")) return;
  const [a] = await ctx.db.select().from(activity).where(eq(activity.id, activityId));
  if (!a || a.patronPersonId !== ctx.personId) throw new ForbiddenError("activities.manage");
}

export async function activityMembers(ctx: SchoolContext, activityId: string) {
  await assertManagesActivity(ctx, activityId);
  return ctx.db
    .select({ studentId: student.id, first: student.firstName, last: student.lastName, adm: student.admissionNumber, role: activityMember.role, joinedOn: activityMember.joinedOn })
    .from(activityMember)
    .innerJoin(student, eq(student.id, activityMember.studentId))
    .where(and(eq(activityMember.activityId, activityId), isNull(activityMember.leftOn)))
    .orderBy(asc(student.lastName));
}

export async function addActivityMember(ctx: SchoolContext, raw: unknown) {
  const v = z.object({ activityId: z.string().uuid(), admissionNumber: z.string().trim().min(1), role: z.string().trim().max(60).optional() }).parse(raw);
  await assertManagesActivity(ctx, v.activityId);
  const [s] = await ctx.db.select({ id: student.id }).from(student).where(eq(student.admissionNumber, v.admissionNumber));
  if (!s) throw new UserError("No student with that admission number.");
  await ctx.db.insert(activityMember).values({ activityId: v.activityId, studentId: s.id, role: v.role || null, joinedOn: new Date().toISOString().slice(0, 10) }).onConflictDoNothing();
}

export async function removeActivityMember(ctx: SchoolContext, activityId: string, studentId: string) {
  await assertManagesActivity(ctx, activityId);
  // History is kept: membership is ended, not deleted.
  await ctx.db.update(activityMember).set({ leftOn: new Date().toISOString().slice(0, 10) }).where(and(eq(activityMember.activityId, activityId), eq(activityMember.studentId, studentId), isNull(activityMember.leftOn)));
}

export async function studentActivities(ctx: SchoolContext, studentId: string) {
  await requireVisibleStudent(ctx, studentId);
  return ctx.db.select({ name: activity.name, kind: activity.kind, role: activityMember.role, joinedOn: activityMember.joinedOn, leftOn: activityMember.leftOn }).from(activityMember).innerJoin(activity, eq(activity.id, activityMember.activityId)).where(eq(activityMember.studentId, studentId));
}
