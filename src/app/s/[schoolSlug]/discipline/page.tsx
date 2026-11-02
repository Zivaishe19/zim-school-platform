import type { Metadata } from "next";
import Link from "next/link";
import { listIncidents } from "@/modules/discipline/service";
import { can } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Flash, Table, Tabs } from "@/ui/kit";
import { decideIncident } from "../_actions/admin";
import { guard, load, str } from "../_lib";

export const metadata: Metadata = { title: "Discipline" };

export default async function DisciplinePage(props: PageProps<"/s/[schoolSlug]/discipline">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "discipline.report") || can(ctx, "discipline.decide") || can(ctx, "discipline.view_all"));
  const status = (["reported", "approved", "dismissed"] as const).find((s) => s === str(sp.status)) ?? "reported";
  const rows = await listIncidents(ctx, status);
  const here = `${base}/discipline?status=${status}`;
  return (
    <>
      <PageHeader title="Discipline" description="Teachers report incidents from a student's page. Only the headmaster decides actions. Restricted records." />
      <Flash sp={sp} />
      <Tabs current={here} items={["reported", "approved", "dismissed"].map((s) => ({ href: `${base}/discipline?status=${s}`, label: s }))} />
      <Table caption="Incidents" rows={rows} rowKey={(r) => r.i.id} empty="Nothing here." columns={[
        { header: "Student", cell: (r) => <Link className="text-brand-700 underline" href={`${base}/students/${r.i.studentId}?tab=discipline`}>{r.last}, {r.first}</Link> },
        { header: "Date", cell: (r) => r.i.occurredOn },
        { header: "Category", cell: (r) => r.i.category.replace("_", " ") },
        { header: "What happened", cell: (r) => <>{r.i.description}{r.i.recommendedAction ? <span className="block text-xs text-slate-600">Recommended: {r.i.recommendedAction}</span> : null}</> },
        { header: status === "reported" && can(ctx, "discipline.decide") ? "Decide" : "Outcome", cell: (r) => status === "reported" && can(ctx, "discipline.decide") ? (
          <ActionForm action={decideIncident.bind(null, slug)} back={here} className="flex flex-col gap-1">
            <input type="hidden" name="id" value={r.i.id} />
            <input name="approvedAction" placeholder="Approved action (warning, detention…)" aria-label="Approved action" className="min-h-9 rounded border border-slate-300 px-2 text-sm" />
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="visibleToParent" className="size-4" />Show to parent</label>
            <div className="flex gap-1">
              <button name="decision" value="approved" className="rounded bg-brand-600 px-2 py-1 text-xs font-semibold text-white">Approve</button>
              <button name="decision" value="dismissed" className="rounded border border-slate-300 px-2 py-1 text-xs">Dismiss</button>
            </div>
          </ActionForm>
        ) : <>{r.i.approvedAction ?? ""} <Badge>{r.i.status}</Badge>{r.i.visibleToParent ? <span className="block text-xs">visible to parent</span> : null}</> },
      ]} />
    </>
  );
}
