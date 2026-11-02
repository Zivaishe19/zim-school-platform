import "server-only";
import Papa from "papaparse";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { groupMember, period, person, room, subject, teachingGroup, timetableEntry, timetableOverride } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { assertCan, type SchoolContext } from "@/server/tenancy/context";
import { myStudentRecord } from "@/server/tenancy/scope";
import { guardianIds, notify, studentPersonIds } from "@/modules/comms/notify";
import { currentYear } from "@/modules/setup/service";

export const ENTRY_KINDS = ["lesson", "sport", "exam", "meeting", "activity"] as const;

type Slot = { periodId: string; groupId: string | null; roomId: string | null };

/**
 * Hard conflicts (blocked): a teacher, room or student booked twice in one period.
 * Soft conflicts (warnings): room smaller than the group.
 */
async function checkConflicts(ctx: SchoolContext, candidate: Slot, existing: Slot[]) {
  const hard: string[] = [];
  const soft: string[] = [];
  const same = existing.filter((e) => e.periodId === candidate.periodId);
  const groupIds = [...new Set([candidate.groupId, ...same.map((s) => s.groupId)].filter((x): x is string => Boolean(x)))];
  const groups = groupIds.length ? await ctx.db.select().from(teachingGroup).where(inArray(teachingGroup.id, groupIds)) : [];
  const g = groups.find((x) => x.id === candidate.groupId);

  if (candidate.roomId && same.some((s) => s.roomId === candidate.roomId)) hard.push("That room is already booked in this period.");
  if (g?.teacherPersonId && same.some((s) => groups.find((x) => x.id === s.groupId)?.teacherPersonId === g.teacherPersonId)) hard.push("The teacher already has a lesson in this period.");
  if (g) {
    if (same.some((s) => s.groupId === g.id)) hard.push("This group already has something in this period.");
    const otherIds = same.map((s) => s.groupId).filter((x): x is string => Boolean(x) && x !== g.id);
    if (otherIds.length) {
      const mine = (await ctx.db.select({ s: groupMember.studentId }).from(groupMember).where(eq(groupMember.teachingGroupId, g.id))).map((r) => r.s);
      if (mine.length) {
        const clash = await ctx.db.select({ s: groupMember.studentId }).from(groupMember).where(and(inArray(groupMember.teachingGroupId, otherIds), inArray(groupMember.studentId, mine))).limit(1);
        if (clash.length) hard.push("Some students in this group are already in another lesson in this period.");
      }
      if (candidate.roomId) {
        const [r] = await ctx.db.select().from(room).where(eq(room.id, candidate.roomId));
        const size = mine.length;
        if (r?.capacity && size > r.capacity) soft.push(`Room capacity ${r.capacity} is smaller than the group (${size}).`);
      }
    }
  }
  return { hard, soft };
}

export async function addEntry(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "timetable.manage");
  const v = z
    .object({ periodIds: z.array(z.string().uuid()).min(1, "Choose at least one period"), kind: z.enum(ENTRY_KINDS), teachingGroupId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)), roomId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)), label: z.string().trim().max(80).optional() })
    .parse(raw);
  if (v.kind === "lesson" && !v.teachingGroupId) throw new UserError("A lesson needs a teaching group.");
  const year = await currentYear(ctx);
  if (!year) throw new UserError("Create an academic year first.");
  const existing = await ctx.db.select({ periodId: timetableEntry.periodId, groupId: timetableEntry.teachingGroupId, roomId: timetableEntry.roomId }).from(timetableEntry).where(eq(timetableEntry.academicYearId, year.id));
  const warnings: string[] = [];
  for (const periodId of v.periodIds) {
    const c = await checkConflicts(ctx, { periodId, groupId: v.teachingGroupId ?? null, roomId: v.roomId ?? null }, existing);
    if (c.hard.length) throw new UserError(c.hard.join(" "));
    warnings.push(...c.soft);
  }
  await ctx.db.transaction(async (tx) => {
    for (const periodId of v.periodIds) {
      await tx.insert(timetableEntry).values({ academicYearId: year.id, periodId, kind: v.kind, teachingGroupId: v.teachingGroupId ?? null, roomId: v.roomId ?? null, label: v.label || null });
    }
    await recordSchoolAudit(tx, ctx, "timetable.entry_added", { type: "teaching_group", id: v.teachingGroupId ?? v.label ?? "-" }, { periods: v.periodIds.length });
  });
  return warnings;
}

export async function removeEntry(ctx: SchoolContext, id: string) {
  assertCan(ctx, "timetable.manage");
  await ctx.db.delete(timetableEntry).where(eq(timetableEntry.id, z.string().uuid().parse(id)));
  await recordSchoolAudit(ctx.db, ctx, "timetable.entry_removed", { type: "timetable_entry", id });
}

/** Temporary change for one date. The baseline timetable is never modified. */
export async function addOverride(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "timetable.manage");
  const v = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      periodId: z.string().uuid(),
      change: z.enum(["cancelled", "changed", "added"]),
      entryId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
      kind: z.enum(ENTRY_KINDS).optional(),
      teachingGroupId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
      roomId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
      substituteTeacherPersonId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
      label: z.string().trim().max(80).optional(),
      reason: z.string().trim().min(3, "Give a reason").max(300),
    })
    .parse(raw);
  if (v.change !== "added" && !v.entryId) throw new UserError("Choose the lesson being cancelled or changed.");
  const [p] = await ctx.db.select().from(period).where(eq(period.id, v.periodId));
  const weekday = ((new Date(`${v.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  if (!p || p.weekday !== weekday) throw new UserError("That period is not on the chosen date's weekday.");

  if (v.change === "added" || v.roomId) {
    const day = await dayEntries(ctx, v.date);
    const c = await checkConflicts(ctx, { periodId: v.periodId, groupId: v.change === "added" ? (v.teachingGroupId ?? null) : null, roomId: v.roomId ?? null }, day.filter((d) => d.id !== v.entryId).map((d) => ({ periodId: d.periodId, groupId: d.groupId, roomId: d.roomId })));
    if (c.hard.length) throw new UserError(c.hard.join(" "));
  }
  const [o] = await ctx.db.insert(timetableOverride).values({ ...v, entryId: v.entryId ?? null, kind: v.kind ?? null, teachingGroupId: v.teachingGroupId ?? null, roomId: v.roomId ?? null, substituteTeacherPersonId: v.substituteTeacherPersonId ?? null, label: v.label || null, createdBy: ctx.user.id }).returning({ id: timetableOverride.id });

  // Notify affected students, their guardians, and teachers.
  let groupId = v.teachingGroupId ?? null;
  if (!groupId && v.entryId) groupId = (await ctx.db.select({ g: timetableEntry.teachingGroupId }).from(timetableEntry).where(eq(timetableEntry.id, v.entryId)))[0]?.g ?? null;
  if (groupId) {
    const studs = (await ctx.db.select({ s: groupMember.studentId }).from(groupMember).where(eq(groupMember.teachingGroupId, groupId))).map((r) => r.s);
    const [g] = await ctx.db.select().from(teachingGroup).where(eq(teachingGroup.id, groupId));
    const recipients = [...(await studentPersonIds(ctx.db, studs)), ...(await guardianIds(ctx.db, studs)), ...(g?.teacherPersonId ? [g.teacherPersonId] : []), ...(v.substituteTeacherPersonId ? [v.substituteTeacherPersonId] : [])];
    await notify(ctx.db, recipients, { title: `Timetable change on ${v.date} (${p.label}): ${v.change}`, body: v.reason, source: "timetable", link: `/s/${ctx.school.slug}/timetable?date=${v.date}` });
  }
  await recordSchoolAudit(ctx.db, ctx, "timetable.override_added", { type: "timetable_override", id: o!.id }, { date: v.date, change: v.change });
}

export async function removeOverride(ctx: SchoolContext, id: string) {
  assertCan(ctx, "timetable.manage");
  await ctx.db.delete(timetableOverride).where(eq(timetableOverride.id, z.string().uuid().parse(id)));
  await recordSchoolAudit(ctx.db, ctx, "timetable.override_removed", { type: "timetable_override", id });
}

type Cell = { id: string; periodId: string; groupId: string | null; roomId: string | null; kind: string; title: string; roomName: string | null; teacher: string | null; teacherPersonId: string | null; change?: string; reason?: string | null };

async function baseline(ctx: SchoolContext): Promise<Cell[]> {
  const year = await currentYear(ctx);
  if (!year) return [];
  const rows = await ctx.db
    .select({ e: timetableEntry, groupName: teachingGroup.name, subjectName: subject.name, roomName: room.name, tFirst: person.firstName, tLast: person.lastName, teacherPersonId: teachingGroup.teacherPersonId })
    .from(timetableEntry)
    .leftJoin(teachingGroup, eq(teachingGroup.id, timetableEntry.teachingGroupId))
    .leftJoin(subject, eq(subject.id, teachingGroup.subjectId))
    .leftJoin(room, eq(room.id, timetableEntry.roomId))
    .leftJoin(person, eq(person.id, teachingGroup.teacherPersonId))
    .where(eq(timetableEntry.academicYearId, year.id));
  return rows.map((r) => ({
    id: r.e.id,
    periodId: r.e.periodId,
    groupId: r.e.teachingGroupId,
    roomId: r.e.roomId,
    kind: r.e.kind,
    title: r.subjectName ? `${r.subjectName} (${r.groupName})` : (r.e.label ?? r.e.kind),
    roomName: r.roomName,
    teacher: r.tFirst ? `${r.tFirst} ${r.tLast}` : null,
    teacherPersonId: r.teacherPersonId,
  }));
}

/** Effective entries for one date: baseline + that date's overrides. */
async function dayEntries(ctx: SchoolContext, date: string): Promise<Cell[]> {
  const weekday = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const periods = await ctx.db.select().from(period).where(eq(period.weekday, weekday));
  const pids = new Set(periods.map((p) => p.id));
  const base = (await baseline(ctx)).filter((b) => pids.has(b.periodId));
  const ovs = await ctx.db
    .select({ o: timetableOverride, groupName: teachingGroup.name, subjectName: subject.name, roomName: room.name, sFirst: person.firstName, sLast: person.lastName })
    .from(timetableOverride)
    .leftJoin(teachingGroup, eq(teachingGroup.id, timetableOverride.teachingGroupId))
    .leftJoin(subject, eq(subject.id, teachingGroup.subjectId))
    .leftJoin(room, eq(room.id, timetableOverride.roomId))
    .leftJoin(person, eq(person.id, timetableOverride.substituteTeacherPersonId))
    .where(eq(timetableOverride.date, date));
  const out: Cell[] = [];
  for (const b of base) {
    const o = ovs.find((x) => x.o.entryId === b.id);
    if (!o) out.push(b);
    else if (o.o.change === "cancelled") out.push({ ...b, change: "cancelled", reason: o.o.reason });
    else out.push({ ...b, roomId: o.o.roomId ?? b.roomId, roomName: o.roomName ?? b.roomName, teacher: o.sFirst ? `${o.sFirst} ${o.sLast} (substitute)` : b.teacher, teacherPersonId: o.o.substituteTeacherPersonId ?? b.teacherPersonId, change: "changed", reason: o.o.reason, title: o.o.label ? `${b.title} – ${o.o.label}` : b.title });
  }
  for (const o of ovs.filter((x) => x.o.change === "added")) {
    out.push({ id: o.o.id, periodId: o.o.periodId, groupId: o.o.teachingGroupId, roomId: o.o.roomId, kind: o.o.kind ?? "lesson", title: o.subjectName ? `${o.subjectName} (${o.groupName})` : (o.o.label ?? o.o.kind ?? "Added"), roomName: o.roomName, teacher: o.sFirst ? `${o.sFirst} ${o.sLast}` : null, teacherPersonId: o.o.substituteTeacherPersonId, change: "added", reason: o.o.reason });
  }
  return out;
}

export type GridFilter = { kind: "all" | "group" | "room" | "teacher" | "me"; id?: string };

/** A week grid (Mon-Fri) starting on the Monday of `date`, filtered for one view. */
export async function weekGrid(ctx: SchoolContext, date: string, filter: GridFilter) {
  const d = new Date(`${z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(date)}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  const days = Array.from({ length: 5 }, (_, i) => new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const periods = await ctx.db.select().from(period).where(and(gte(period.weekday, 1), lte(period.weekday, 5))).orderBy(asc(period.number), asc(period.weekday));

  let groupFilter: Set<string> | null = null;
  if (filter.kind === "me") {
    const me = await myStudentRecord(ctx);
    if (me) groupFilter = new Set((await ctx.db.select({ g: groupMember.teachingGroupId }).from(groupMember).where(eq(groupMember.studentId, me.id))).map((r) => r.g));
  } else if (filter.kind === "group" && filter.id) groupFilter = new Set([filter.id]);

  const cellsByDay: Record<string, Cell[]> = {};
  for (const day of days) {
    let cells = await dayEntries(ctx, day);
    if (filter.kind === "me" && !groupFilter) cells = cells.filter((c) => c.teacherPersonId === ctx.personId);
    else if (groupFilter) cells = cells.filter((c) => (c.groupId ? groupFilter!.has(c.groupId) : c.kind !== "lesson"));
    if (filter.kind === "room" && filter.id) cells = cells.filter((c) => c.roomId === filter.id);
    if (filter.kind === "teacher" && filter.id) cells = cells.filter((c) => c.teacherPersonId === filter.id);
    cellsByDay[day] = cells;
  }
  const numbers = [...new Set(periods.map((p) => p.number))].sort((a, b) => a - b);
  return { days, numbers, periods, cellsByDay };
}

/** CSV: weekday,period_number,group_name,room,kind,label (baseline, current year). */
export async function importTimetable(ctx: SchoolContext, file: File | null) {
  assertCan(ctx, "timetable.manage");
  if (!file || !file.size || file.size > 1_000_000) throw new UserError("Choose a CSV file under 1 MB.");
  const parsed = Papa.parse<Record<string, string>>((await file.text()).replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });
  const periods = await ctx.db.select().from(period);
  const groups = await ctx.db.select().from(teachingGroup);
  const rooms = await ctx.db.select().from(room);
  const errors: string[] = [];
  let added = 0;
  for (const [i, r] of parsed.data.entries()) {
    const p = periods.find((x) => x.weekday === Number(r.weekday) && x.number === Number(r.period_number));
    const g = r.group_name ? groups.find((x) => x.name === r.group_name.trim()) : undefined;
    const rm = r.room ? rooms.find((x) => x.name === r.room.trim()) : undefined;
    if (!p) { errors.push(`line ${i + 2}: no period ${r.weekday}/${r.period_number}`); continue; }
    if (r.group_name && !g) { errors.push(`line ${i + 2}: unknown group "${r.group_name}"`); continue; }
    try {
      await addEntry(ctx, { periodIds: [p.id], kind: (r.kind || "lesson").trim(), teachingGroupId: g?.id ?? "", roomId: rm?.id ?? "", label: r.label ?? "" });
      added++;
    } catch (e) {
      errors.push(`line ${i + 2}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return { added, errors };
}
