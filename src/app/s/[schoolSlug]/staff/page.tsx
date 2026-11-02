import type { Metadata } from "next";
import Link from "next/link";
import { myStaffAttendance, STAFF_STATUSES, staffRegister } from "@/modules/staff/service";
import { can } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Flash, Input, Section, SubmitButton, Table, Tabs, today } from "@/ui/kit";
import { saveStaffRegister } from "../_actions/admin";
import { guard, load, str } from "../_lib";
import { staffTabs } from "./tabs";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage(props: PageProps<"/s/[schoolSlug]/staff">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "staff_attendance.view") || can(ctx, "leave.request") || can(ctx, "leave.review"));
  const tabs = staffTabs(base, (p) => can(ctx, p));
  if (!can(ctx, "staff_attendance.view")) {
    const mine = await myStaffAttendance(ctx);
    return (
      <>
        <PageHeader title="Staff" />
        <Tabs items={tabs} current={`${base}/staff`} />
        <Table caption="My attendance" rows={mine} rowKey={(r) => r.id} empty="No records." columns={[{ header: "Date", cell: (r) => r.date }, { header: "Status", cell: (r) => <Badge>{r.status}</Badge> }, { header: "In", cell: (r) => r.timeIn?.slice(0, 5) ?? "" }, { header: "Out", cell: (r) => r.timeOut?.slice(0, 5) ?? "" }]} />
      </>
    );
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.date)) ? str(sp.date) : today();
  const rows = await staffRegister(ctx, date);
  const editable = can(ctx, "staff_attendance.manage");
  return (
    <>
      <PageHeader title="Staff" />
      <Tabs items={tabs} current={`${base}/staff`} />
      <Flash sp={sp} />
      <form className="mb-4 flex items-end gap-2" action={`${base}/staff`}><Input label="Date" name="date" type="date" defaultValue={date} max={today()} /><button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button></form>
      <Section title={`Staff register · ${date}`}>
        <ActionForm action={saveStaffRegister.bind(null, slug)} back={`${base}/staff?date=${date}`}>
          <input type="hidden" name="date" value={date} />
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th><th className="px-3 py-2">Note</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.lastName}, {r.firstName}</td>
                    <td className="px-3 py-2"><select name={`status_${r.id}`} defaultValue={r.status} disabled={!editable} aria-label={`Status for ${r.firstName}`} className="min-h-10 rounded border border-slate-300 bg-white px-2"><option value="">—</option>{STAFF_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></td>
                    <td className="px-3 py-2"><input type="time" name={`in_${r.id}`} defaultValue={r.timeIn?.slice(0, 5)} disabled={!editable} aria-label="Time in" className="min-h-10 rounded border border-slate-300 px-1" /></td>
                    <td className="px-3 py-2"><input type="time" name={`out_${r.id}`} defaultValue={r.timeOut?.slice(0, 5)} disabled={!editable} aria-label="Time out" className="min-h-10 rounded border border-slate-300 px-1" /></td>
                    <td className="px-3 py-2"><input name={`note_${r.id}`} defaultValue={r.note} disabled={!editable} aria-label="Note" className="min-h-10 w-full rounded border border-slate-300 px-2" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable ? <div><SubmitButton>Save register</SubmitButton></div> : null}
        </ActionForm>
      </Section>
      <p className="text-sm"><Link className="text-brand-700 underline" href={`${base}/staff/leave`}>Leave requests</Link></p>
    </>
  );
}
