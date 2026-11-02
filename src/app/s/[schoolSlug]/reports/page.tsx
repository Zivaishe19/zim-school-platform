import type { Metadata } from "next";
import Link from "next/link";
import { myClassesLed } from "@/modules/discipline/service";
import { publishedReportsFor, submittedReports } from "@/modules/reports/service";
import { currentTerm, currentYear, listClasses } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { myChildren, myStudentRecord } from "@/server/tenancy/scope";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Flash, fmtDate, Section, SubmitButton, Table } from "@/ui/kit";
import { approveReport, publishReports } from "../_actions/academic";
import { load } from "../_lib";

export const metadata: Metadata = { title: "Report cards" };

export default async function ReportsPage(props: PageProps<"/s/[schoolSlug]/reports">) {
  const { ctx, sp, base, slug } = await load(props);
  const term = await currentTerm(ctx);
  const yr = await currentYear(ctx);
  const led = can(ctx, "reports.prepare") ? await myClassesLed(ctx) : [];
  const viewAll = can(ctx, "reports.view_all") ? await listClasses(ctx, yr?.id) : [];
  const queue = can(ctx, "reports.approve") ? await submittedReports(ctx) : [];
  const kids = [...(can(ctx, "portal.guardian") ? await myChildren(ctx) : []), ...(can(ctx, "portal.student") ? [await myStudentRecord(ctx)].filter((x) => x !== null) : [])];
  const kidReports = await Promise.all(kids.map(async (k) => ({ k, reps: await publishedReportsFor(ctx, k.id) })));
  const classes = [...led, ...viewAll.filter((c) => !led.some((l) => l.id === c.id)).map((c) => ({ id: c.id, name: c.name }))];
  return (
    <>
      <PageHeader title="Report cards" description={term ? `Current term: ${term.name}` : "No term set up"} />
      <Flash sp={sp} />
      {classes.length && term ? (
        <Section title="Classes">
          <ul className="grid gap-2 sm:grid-cols-3">{classes.map((c) => <li key={c.id}><Link className="block rounded-lg border border-slate-200 bg-white px-4 py-3 font-medium text-brand-700 hover:bg-brand-50" href={`${base}/reports/class/${c.id}?term=${term.id}`}>{c.name}</Link></li>)}</ul>
          <p className="mt-2 text-sm text-slate-600">Workflow: the class teacher writes a comment and submits → the headmaster approves (the report is frozen) → the headmaster publishes it to parents and the student.</p>
        </Section>
      ) : null}
      {can(ctx, "reports.approve") ? (
        <Section title="Waiting for approval or publishing">
          {queue.filter((q) => q.status === "submitted").map((q) => (
            <Card key={q.id} className="mb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><Link className="font-medium text-brand-700 underline" href={`${base}/reports/${q.id}`}>{q.last}, {q.first}</Link> · {q.className} · {q.termName}</span>
                <ActionForm action={approveReport.bind(null, slug)} back={`${base}/reports`} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="reportId" value={q.id} />
                  <input name="headComment" placeholder="Headmaster's comment" aria-label="Headmaster's comment" className="min-h-10 w-64 rounded border border-slate-300 px-2" />
                  <SubmitButton variant="secondary">Approve</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ))}
          <ActionForm action={publishReports.bind(null, slug)} back={`${base}/reports`}>
            <Table caption="Approved reports" rows={queue.filter((q) => q.status === "approved")} rowKey={(q) => q.id} empty="No approved reports waiting to be published." columns={[
              { header: "Publish", cell: (q) => <input type="checkbox" name="reportIds" value={q.id} defaultChecked aria-label={`Publish ${q.first}`} className="size-5" /> },
              { header: "Student", cell: (q) => <Link className="text-brand-700 underline" href={`${base}/reports/${q.id}`}>{q.last}, {q.first}</Link> },
              { header: "Class", cell: (q) => q.className },
              { header: "Term", cell: (q) => q.termName },
            ]} />
            {queue.some((q) => q.status === "approved") ? <div><SubmitButton confirm="Publish the selected reports to parents and students?">Publish selected</SubmitButton></div> : null}
          </ActionForm>
        </Section>
      ) : null}
      {kidReports.map(({ k, reps }) => (
        <Section key={k.id} title={`${k.firstName} ${k.lastName}`}>
          <Table caption="Published reports" rows={reps} rowKey={(r) => r.id} empty="No published reports yet." columns={[
            { header: "Term", cell: (r) => <Link className="text-brand-700 underline" href={`${base}/reports/${r.id}`}>{r.termName}</Link> },
            { header: "Published", cell: (r) => fmtDate(r.publishedAt) },
            { header: "Status", cell: (r) => <Badge>{r.status}</Badge> },
          ]} />
        </Section>
      ))}
    </>
  );
}
