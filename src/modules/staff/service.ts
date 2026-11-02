import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { assessment, attendanceSession, groupMember, leaveRequest, mark, person, staffAttendance, teachingGroup } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { assertCan, can, type SchoolContext } from "@/server/tenancy/context";
import { notify, peopleWithRoles } from "@/modules/comms/notify";
import { listStaff } from "@/modules/people/service";

export const STAFF_STATUSES = ["present", "late", "absent", "leave", "early_departure"] as const;

export async function staffRegister(ctx: SchoolContext, date: string) {
  assertCan(ctx, "staff_attendance.view");
  const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(date);
  const staffList = await listStaff(ctx);
  const rows = await ctx.db.select().from(staffAttendance).where(eq(staffAttendance.date, d));
  const onLeave = await ctx.db.select({ personId: leaveRequest.personId }).from(leaveRequest).where(and(eq(leaveRequest.status, "approved"), sql`${leaveRequest.dateFrom} <= ${d} and ${leaveRequest.dateTo} >= ${d}`));
  return staffList.map((s) => {
    const r = rows.find((x) => x.personId === s.id);
    return { ...s, status: r?.status ?? (onLeave.some((l) => l.personId === s.id) ? "leave" : ""), timeIn: r?.timeIn ?? "", timeOut: r?.timeOut ?? "", note: r?.note ?? "" };
  });
}

export async function saveStaffRegister(ctx: SchoolContext, values: Record<string, string | string[]>) {
  assertCan(ctx, "staff_attendance.manage");
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(values.date);
  const staffList = await listStaff(ctx);
  const time = z.string().regex(/^(\d{2}:\d{2})?$/);
  await ctx.db.transaction(async (tx) => {
    for (const s of staffList) {
      const st = String(values[`status_${s.id}`] ?? "");
      if (!st) continue;
      const status = z.enum(STAFF_STATUSES).parse(st);
      const timeIn = time.parse(String(values[`in_${s.id}`] ?? "")) || null;
      const timeOut = time.parse(String(values[`out_${s.id}`] ?? "")) || null;
      const note = String(values[`note_${s.id}`] ?? "").slice(0, 200) || null;
      await tx
        .insert(staffAttendance)
        .values({ personId: s.id, date, status, timeIn, timeOut, note, recordedBy: ctx.user.id })
        .onConflictDoUpdate({ target: [staffAttendance.personId, staffAttendance.date], set: { status, timeIn, timeOut, note, recordedBy: ctx.user.id } });
    }
    await recordSchoolAudit(tx, ctx, "staff_attendance.saved", { type: "date", id: date });
  });
}

export async function myStaffAttendance(ctx: SchoolContext) {
  if (!ctx.personId) return [];
  return ctx.db.select().from(staffAttendance).where(eq(staffAttendance.personId, ctx.personId)).orderBy(desc(staffAttendance.date)).limit(60);
}

// ------------------------------------------------------------------ leave
export async function requestLeave(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "leave.request");
  const v = z.object({ dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), kind: z.enum(["annual", "sick", "maternity", "study", "compassionate", "other"]), reason: z.string().trim().max(500).optional() }).parse(raw);
  if (v.dateTo < v.dateFrom) throw new UserError("The end date is before the start date.");
  await ctx.db.insert(leaveRequest).values({ personId: ctx.personId!, ...v, reason: v.reason || null });
  await notify(ctx.db, await peopleWithRoles(ctx.db, ["headmaster"]), { title: "New leave request", source: "staff", link: `/s/${ctx.school.slug}/staff/leave` });
}

export async function listLeave(ctx: SchoolContext) {
  const all = can(ctx, "leave.review");
  return ctx.db
    .select({ l: leaveRequest, first: person.firstName, last: person.lastName })
    .from(leaveRequest)
    .innerJoin(person, eq(person.id, leaveRequest.personId))
    .where(all ? undefined : eq(leaveRequest.personId, ctx.personId ?? "00000000-0000-0000-0000-000000000000"))
    .orderBy(desc(leaveRequest.createdAt))
    .limit(200);
}

export async function reviewLeave(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "leave.review");
  const v = z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }).parse(raw);
  const [l] = await ctx.db.update(leaveRequest).set({ status: v.decision, reviewedBy: ctx.user.id }).where(and(eq(leaveRequest.id, v.id), eq(leaveRequest.status, "pending"))).returning();
  if (!l) throw new UserError("Request not found or already decided.");
  await notify(ctx.db, [l.personId], { title: `Leave request ${v.decision}`, source: "staff", link: `/s/${ctx.school.slug}/staff/leave` });
  await recordSchoolAudit(ctx.db, ctx, `leave.${v.decision}`, { type: "leave_request", id: l.id });
}

// ------------------------------------------------------------------ teacher indicators
/**
 * Transparent, descriptive indicators for the last N days. Deliberately NOT based on
 * student marks alone, and not combined into a single score. Definitions are shown in the UI.
 */
export async function teacherIndicators(ctx: SchoolContext, days = 30) {
  assertCan(ctx, "teacher_performance.view");
  const since = new Date(Date.now() - days * 86_400_000);
  const sinceDate = since.toISOString().slice(0, 10);
  const teachers = (await listStaff(ctx)).filter((s) => s.roles.includes("teacher"));
  const out = [];
  for (const t of teachers) {
    const groups = await ctx.db.select({ id: teachingGroup.id }).from(teachingGroup).where(eq(teachingGroup.teacherPersonId, t.id));
    const gids = groups.map((g) => g.id);
    const students = gids.length ? ((await ctx.db.select({ n: sql<number>`count(distinct ${groupMember.studentId})::int` }).from(groupMember).where(inArray(groupMember.teachingGroupId, gids)))[0]?.n ?? 0) : 0;
    const registers = gids.length ? ((await ctx.db.select({ n: sql<number>`count(*)::int` }).from(attendanceSession).where(and(inArray(attendanceSession.teachingGroupId, gids), gte(attendanceSession.date, sinceDate))))[0]?.n ?? 0) : 0;
    const assess = gids.length ? await ctx.db.select({ id: assessment.id }).from(assessment).where(and(inArray(assessment.teachingGroupId, gids), gte(assessment.createdAt, since))) : [];
    const aids = assess.map((a) => a.id);
    const markStats = aids.length
      ? (await ctx.db.select({ total: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${mark.score} is not null or ${mark.status} = 'missing')::int` }).from(mark).where(inArray(mark.assessmentId, aids)))[0]
      : { total: 0, done: 0 };
    const att = await ctx.db
      .select({ late: sql<number>`count(*) filter (where ${staffAttendance.status} = 'late')::int`, absent: sql<number>`count(*) filter (where ${staffAttendance.status} = 'absent')::int`, recorded: sql<number>`count(*)::int` })
      .from(staffAttendance)
      .where(and(eq(staffAttendance.personId, t.id), gte(staffAttendance.date, sinceDate)));
    out.push({
      personId: t.id,
      name: `${t.firstName} ${t.lastName}`,
      groups: gids.length,
      students,
      registersTaken: registers,
      assessmentsSet: aids.length,
      markingCompletion: markStats && markStats.total ? Math.round((markStats.done / markStats.total) * 100) : null,
      daysLate: att[0]?.late ?? 0,
      daysAbsent: att[0]?.absent ?? 0,
      daysRecorded: att[0]?.recorded ?? 0,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function staffNames(ctx: SchoolContext) {
  return ctx.db.select({ id: person.id, first: person.firstName, last: person.lastName }).from(person).orderBy(asc(person.lastName));
}
