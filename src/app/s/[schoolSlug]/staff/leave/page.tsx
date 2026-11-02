import type { Metadata } from "next";
import { listLeave } from "@/modules/staff/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Flash, Grid, Input, Select, SubmitButton, Table, Tabs, TextArea } from "@/ui/kit";
import { requestLeave, reviewLeave } from "../../_actions/admin";
import { guard, load } from "../../_lib";
import { staffTabs } from "../tabs";

export const metadata: Metadata = { title: "Leave" };

export default async function LeavePage(props: PageProps<"/s/[schoolSlug]/staff/leave">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "leave.request") || can(ctx, "leave.review"));
  const rows = await listLeave(ctx);
  const here = `${base}/staff/leave`;
  return (
    <>
      <PageHeader title="Staff" />
      <Tabs items={staffTabs(base, (p) => can(ctx, p))} current={here} />
      <Flash sp={sp} />
      {can(ctx, "leave.request") ? (
        <Card className="mb-4 max-w-2xl">
          <h2 className="mb-2 font-semibold">Request leave</h2>
          <ActionForm action={requestLeave.bind(null, slug)} back={here}>
            <Grid><Input label="From" name="dateFrom" type="date" required /><Input label="To" name="dateTo" type="date" required /><Select label="Kind" name="kind" options={["annual", "sick", "maternity", "study", "compassionate", "other"].map((k) => ({ value: k, label: k }))} /></Grid>
            <TextArea label="Reason (optional)" name="reason" />
            <div><SubmitButton>Send request</SubmitButton></div>
          </ActionForm>
        </Card>
      ) : null}
      <Table caption="Leave requests" rows={rows} rowKey={(r) => r.l.id} empty="No leave requests." columns={[
        { header: "Staff", cell: (r) => `${r.last}, ${r.first}` }, { header: "Dates", cell: (r) => `${r.l.dateFrom} to ${r.l.dateTo}` },
        { header: "Kind", cell: (r) => r.l.kind }, { header: "Reason", cell: (r) => r.l.reason ?? "", hideOnMobile: true },
        { header: "Status", cell: (r) => r.l.status === "pending" && can(ctx, "leave.review") ? (
          <ActionForm action={reviewLeave.bind(null, slug)} back={here} className="flex gap-1"><input type="hidden" name="id" value={r.l.id} />
            <button name="decision" value="approved" className="rounded bg-brand-600 px-2 py-1 text-xs font-semibold text-white">Approve</button>
            <button name="decision" value="rejected" className="rounded border border-slate-300 px-2 py-1 text-xs">Reject</button>
          </ActionForm>
        ) : <Badge>{r.l.status}</Badge> },
      ]} />
    </>
  );
}
