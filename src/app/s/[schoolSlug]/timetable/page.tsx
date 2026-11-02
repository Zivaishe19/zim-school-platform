import type { Metadata } from "next";
import { ENTRY_KINDS, weekGrid, type GridFilter } from "@/modules/timetable/service";
import { listStaff } from "@/modules/people/service";
import { currentYear, listGroups, listPeriods, listRooms } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Details, Flash, Grid, Input, Select, SubmitButton, today } from "@/ui/kit";
import { addEntry, addOverride, importTimetable, removeEntry, removeOverride } from "../_actions/admin";
import { load, str } from "../_lib";

export const metadata: Metadata = { title: "Timetable" };
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export default async function TimetablePage(props: PageProps<"/s/[schoolSlug]/timetable">) {
  const { ctx, sp, base, slug } = await load(props);
  const manage = can(ctx, "timetable.manage");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.date)) ? str(sp.date) : today();
  const [vKind, vId] = str(sp.v).split(":");
  const view = vKind || str(sp.view) || (manage || can(ctx, "students.view_all") ? "all" : "me");
  const filter: GridFilter = { kind: (["all", "group", "room", "teacher", "me"].includes(view) ? view : "me") as GridFilter["kind"], id: vId || str(sp.id) || undefined };
  const yr = await currentYear(ctx);
  const [grid, groups, rooms, staff, periods] = await Promise.all([weekGrid(ctx, date, filter), listGroups(ctx, { yearId: yr?.id }), listRooms(ctx), listStaff(ctx), listPeriods(ctx)]);
  const here = `${base}/timetable?${new URLSearchParams({ date, view, id: filter.id ?? "" })}`;
  const prev = new Date(Date.parse(grid.days[0]!) - 7 * 86_400_000).toISOString().slice(0, 10);
  const next = new Date(Date.parse(grid.days[0]!) + 7 * 86_400_000).toISOString().slice(0, 10);
  const viewOpts = [
    { value: "me", label: "My timetable" },
    ...(manage || can(ctx, "students.view_all") ? [{ value: "all", label: "Whole school" }, ...groups.map((g) => ({ value: `group:${g.id}`, label: `Group: ${g.name}` })), ...rooms.map((r) => ({ value: `room:${r.id}`, label: `Room: ${r.name}` })), ...staff.map((s) => ({ value: `teacher:${s.id}`, label: `Teacher: ${s.lastName}, ${s.firstName}` }))] : []),
  ];
  return (
    <>
      <PageHeader title="Timetable" description={`Week of ${grid.days[0]}. Temporary changes are shown in colour; the baseline timetable is never overwritten.`} />
      <Flash sp={sp} />
      <form className="mb-4 flex flex-wrap items-end gap-2" action={`${base}/timetable`}>
        <Input label="Week containing" name="date" type="date" defaultValue={date} />
        <Select label="Show" name="v" defaultValue={filter.id ? `${view}:${filter.id}` : view} options={viewOpts} />
        <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button>
        <a className="min-h-11 rounded-md px-3 py-3 text-sm text-brand-700 underline" href={`${base}/timetable?${new URLSearchParams({ date: prev, view, id: filter.id ?? "" })}`}>← Previous week</a>
        <a className="min-h-11 rounded-md px-3 py-3 text-sm text-brand-700 underline" href={`${base}/timetable?${new URLSearchParams({ date: next, view, id: filter.id ?? "" })}`}>Next week →</a>
      </form>
      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-xs sm:text-sm">
          <caption className="sr-only">Week timetable</caption>
          <thead className="bg-slate-50"><tr><th className="px-2 py-2">Period</th>{grid.days.map((d, i) => <th key={d} className="px-2 py-2">{DAY[i]} {d.slice(5)}</th>)}</tr></thead>
          <tbody>
            {grid.numbers.map((n) => (
              <tr key={n} className="border-t border-slate-100 align-top">
                <th className="px-2 py-2 whitespace-nowrap">{grid.periods.find((p) => p.number === n)?.label ?? n}<span className="block text-[11px] font-normal text-slate-500">{grid.periods.find((p) => p.number === n)?.startsAt.slice(0, 5)}</span></th>
                {grid.days.map((d, i) => {
                  const p = grid.periods.find((x) => x.weekday === i + 1 && x.number === n);
                  const cells = p ? (grid.cellsByDay[d] ?? []).filter((c) => c.periodId === p.id) : [];
                  return (
                    <td key={d} className="px-2 py-1">
                      {p && p.kind !== "lesson" && !cells.length ? <span className="text-slate-400">{p.label}</span> : null}
                      {cells.map((c) => (
                        <div key={c.id} className={`mb-1 rounded px-1.5 py-1 ${c.change === "cancelled" ? "bg-red-50 line-through" : c.change ? "bg-amber-50" : "bg-slate-50"}`}>
                          <span className="font-medium">{c.title}</span>
                          <span className="block text-[11px] text-slate-600">{[c.teacher, c.roomName].filter(Boolean).join(" · ")}{c.change ? ` · ${c.change}` : ""}</span>
                          {manage && !c.change ? <ActionForm action={removeEntry.bind(null, slug)} back={here} className="inline"><input type="hidden" name="entryId" value={c.id} /><button className="text-[11px] text-red-700 underline">remove</button></ActionForm> : null}
                          {manage && c.change === "added" ? <ActionForm action={removeOverride.bind(null, slug)} back={here} className="inline"><input type="hidden" name="overrideId" value={c.id} /><button className="text-[11px] text-red-700 underline">undo</button></ActionForm> : null}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!grid.numbers.length ? <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No bell schedule yet (Setup &gt; Bell schedule).</td></tr> : null}
          </tbody>
        </table>
      </div>
      {manage ? (
        <>
          <Details summary="Add to the baseline timetable (lessons, sport, exams, meetings)">
            <ActionForm action={addEntry.bind(null, slug)} back={here}>
              <Grid>
                <Select label="Kind" name="kind" options={ENTRY_KINDS.map((k) => ({ value: k, label: k }))} />
                <Select label="Teaching group" name="teachingGroupId" placeholder="— none (e.g. staff meeting) —" options={groups.map((g) => ({ value: g.id, label: g.name }))} />
                <Select label="Room" name="roomId" placeholder="—" options={rooms.map((r) => ({ value: r.id, label: r.name }))} />
                <Input label="Label (for non-lessons)" name="label" placeholder="Staff meeting, Inter-house athletics" />
              </Grid>
              <fieldset className="rounded border border-slate-200 p-2"><legend className="px-1 text-xs text-slate-600">Periods (tick one or more)</legend>
                <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-5">{periods.filter((p) => p.weekday <= 5).map((p) => <label key={p.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="periodIds" value={p.id} className="size-4" />{DAY[p.weekday - 1]} {p.label}</label>)}</div>
              </fieldset>
              <p className="text-sm text-slate-600">Blocked: a teacher, room, group or any student booked twice in a period. Warning only: room smaller than the group.</p>
              <div><SubmitButton>Add</SubmitButton></div>
            </ActionForm>
          </Details>
          <Details summary="Change one day only (cancel, substitute, move room, add an exam or fixture)">
            <ActionForm action={addOverride.bind(null, slug)} back={here}>
              <Grid>
                <Input label="Date" name="date" type="date" defaultValue={date} required />
                <Select label="Period" name="periodId" options={periods.filter((p) => p.weekday <= 5).map((p) => ({ value: p.id, label: `${DAY[p.weekday - 1]} ${p.label}` }))} />
                <Select label="Change" name="change" options={[{ value: "cancelled", label: "Cancel a lesson" }, { value: "changed", label: "Change room / substitute teacher" }, { value: "added", label: "Add something (exam, fixture, extra lesson)" }]} />
                <Select label="Lesson being cancelled/changed" name="entryId" placeholder="— (not needed when adding)" options={Object.values(grid.cellsByDay).flat().filter((c) => !c.change).map((c) => ({ value: c.id, label: `${DAY[(grid.periods.find((p) => p.id === c.periodId)?.weekday ?? 1) - 1]} ${grid.periods.find((p) => p.id === c.periodId)?.label ?? ""}: ${c.title}` }))} />
                <Select label="Kind (when adding)" name="kind" options={ENTRY_KINDS.map((k) => ({ value: k, label: k }))} />
                <Select label="Teaching group (when adding)" name="teachingGroupId" placeholder="—" options={groups.map((g) => ({ value: g.id, label: g.name }))} />
                <Select label="Room" name="roomId" placeholder="— unchanged —" options={rooms.map((r) => ({ value: r.id, label: r.name }))} />
                <Select label="Substitute teacher" name="substituteTeacherPersonId" placeholder="—" options={staff.map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName}` }))} />
                <Input label="Label" name="label" />
                <Input label="Reason (shown to those affected)" name="reason" required />
              </Grid>
              <div><SubmitButton>Save change</SubmitButton></div>
            </ActionForm>
          </Details>
          <Details summary="Import a timetable (CSV)">
            <ActionForm action={importTimetable.bind(null, slug)} back={here} upload>
              <p className="text-sm text-slate-600">Columns: <code>weekday,period_number,group_name,room,kind,label</code> (weekday 1 = Monday). Each row is checked for conflicts like a manual entry.</p>
              <input type="file" name="file" accept=".csv,text/csv" required aria-label="CSV file" className="text-sm" />
              <div><SubmitButton variant="secondary">Import</SubmitButton></div>
            </ActionForm>
          </Details>
          <p className="mt-2 text-sm text-slate-600">Automatic timetable generation is not available yet; build the timetable manually or import it.</p>
        </>
      ) : null}
    </>
  );
}
