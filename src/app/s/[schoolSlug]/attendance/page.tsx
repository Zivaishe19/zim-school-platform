import type { Metadata } from "next";
import Link from "next/link";
import { listExplanations, myRegisters, classAttendanceReport } from "@/modules/attendance/service";
import { listClasses, currentYear } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { myChildren } from "@/server/tenancy/scope";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Flash, Input, Section, Select, Table, today, daysAgo } from "@/ui/kit";
import { reviewExplanation } from "../_actions/academic";
import { load, str } from "../_lib";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage(props: PageProps<"/s/[schoolSlug]/attendance">) {
  const { ctx, sp, base, slug } = await load(props);
  const regs = await myRegisters(ctx);
  const children = can(ctx, "portal.guardian") ? await myChildren(ctx) : [];
  const explanations = can(ctx, "absence.review") || can(ctx, "portal.guardian") ? await listExplanations(ctx, can(ctx, "absence.review") ? "pending" : "all") : [];
  const yr = await currentYear(ctx);
  const allClasses = can(ctx, "attendance.view_all") ? await listClasses(ctx, yr?.id) : [];
  const reportClass = str(sp.reportClass);
  const from = str(sp.from) || daysAgo(30);
  const to = str(sp.to) || today();
  const report = reportClass ? await classAttendanceReport(ctx, reportClass, from, to) : null;
  return (
    <>
      <PageHeader title="Attendance" description="Daily registers count school days; lesson registers are kept separately and never double-counted." />
      <Flash sp={sp} />
      {regs.classes.length || regs.groups.length || allClasses.length ? (
        <Section title="Take a register">
          <Card>
            <form action={`${base}/attendance/register`} className="grid items-end gap-3 sm:grid-cols-4">
              <Select label="Register" name="target" options={[
                ...regs.classes.map((c) => ({ value: `daily:${c.id}`, label: `Daily – ${c.name}` })),
                ...regs.groups.map((g) => ({ value: `lesson:${g.id}`, label: `Lesson – ${g.name}` })),
                ...allClasses.filter((c) => !regs.classes.some((r) => r.id === c.id)).map((c) => ({ value: `daily:${c.id}`, label: `Daily – ${c.name} (admin)` })),
              ]} />
              <Input label="Date" name="date" type="date" defaultValue={today()} max={today()} />
              <Input label="Lesson/period (lesson registers)" name="period" placeholder="Period 3" />
              <button className="min-h-11 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white">Open register</button>
            </form>
          </Card>
        </Section>
      ) : null}

      {children.length ? (
        <Section title="My children">
          <ul className="flex flex-col gap-2">
            {children.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
                <Link className="font-medium text-brand-700 underline" href={`${base}/students/${c.id}?tab=attendance`}>{c.firstName} {c.lastName}</Link>
                <Link className="text-sm underline" href={`${base}/attendance/explain?studentId=${c.id}`}>Explain an absence</Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {explanations.length || can(ctx, "absence.review") ? (
        <Section title={can(ctx, "absence.review") ? "Absence explanations to review" : "My absence explanations"}>
          <Table caption="Absence explanations" rows={explanations} rowKey={(e) => e.id} empty="Nothing waiting." columns={[
            { header: "Student", cell: (e) => `${e.firstName} ${e.lastName}` },
            { header: "Dates", cell: (e) => (e.dateFrom === e.dateTo ? e.dateFrom : `${e.dateFrom} to ${e.dateTo}`) },
            { header: "Reason", cell: (e) => e.reason },
            { header: "Status", cell: (e) => <Badge>{e.status}</Badge> },
            ...(can(ctx, "absence.review") ? [{ header: "Review", cell: (e: (typeof explanations)[number]) => e.status === "pending" ? (
              <ActionForm action={reviewExplanation.bind(null, slug)} back={`${base}/attendance`} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={e.id} />
                <input name="note" placeholder="Note (optional)" aria-label="Note" className="min-h-10 rounded border border-slate-300 px-2" />
                <div className="flex gap-2">
                  <button name="decision" value="approved" className="rounded bg-brand-600 px-3 py-2 text-sm font-semibold text-white">Approve</button>
                  <button name="decision" value="rejected" className="rounded border border-slate-300 px-3 py-2 text-sm">Reject</button>
                </div>
              </ActionForm>
            ) : null }] : []),
          ]} />
        </Section>
      ) : null}

      {allClasses.length ? (
        <Section title="Class attendance report">
          <form className="mb-3 flex flex-wrap items-end gap-2" action={`${base}/attendance`}>
            <Select label="Class" name="reportClass" defaultValue={reportClass} options={allClasses.map((c) => ({ value: c.id, label: c.name }))} />
            <Input label="From" name="from" type="date" defaultValue={from} />
            <Input label="To" name="to" type="date" defaultValue={to} />
            <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button>
          </form>
          {report ? <Table caption="Class attendance" rows={report} rowKey={(r) => r.studentId} empty="No registers in this range." columns={[
            { header: "Student", cell: (r) => `${r.lastName}, ${r.firstName}` },
            { header: "Days", cell: (r) => r.days }, { header: "Present", cell: (r) => r.present }, { header: "Late", cell: (r) => r.late },
            { header: "Absent", cell: (r) => r.absent }, { header: "Approved", cell: (r) => r.approved },
          ]} /> : null}
        </Section>
      ) : null}
    </>
  );
}
