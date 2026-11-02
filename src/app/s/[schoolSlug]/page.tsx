import Link from "next/link";
import { schoolAttendanceRate, myRegisters } from "@/modules/attendance/service";
import { myAnnouncements, upcomingEvents, myThreads } from "@/modules/comms/service";
import { feeTotals, listProofs } from "@/modules/fees/service";
import { listApplications } from "@/modules/admissions/service";
import { listIncidents } from "@/modules/discipline/service";
import { myLearning } from "@/modules/assessments/service";
import { submittedReports } from "@/modules/reports/service";
import { listStudents } from "@/modules/students/service";
import { openLoans } from "@/modules/library/service";
import { listLeave } from "@/modules/staff/service";
import { currentTerm, currentYear } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { myChildren } from "@/server/tenancy/scope";
import { Card, PageHeader } from "@/ui/primitives";
import { Badge, fmtDate, fmtDateTime, money } from "@/ui/kit";
import { load } from "./_lib";

function Stat({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  const body = (
    <Card className="h-full">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Card>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export default async function Dashboard(props: PageProps<"/s/[schoolSlug]">) {
  const { ctx, base } = await load(props);
  const [year, term, announcements, events] = await Promise.all([currentYear(ctx), currentTerm(ctx), myAnnouncements(ctx, 5), upcomingEvents(ctx, 5)]);
  const stats: React.ReactNode[] = [];

  if (can(ctx, "students.view_all")) stats.push(<Stat key="s" label="Students on record" value={(await listStudents(ctx)).total} href={`${base}/students`} />);
  if (can(ctx, "attendance.view_all")) {
    const r = await schoolAttendanceRate(ctx, 7);
    stats.push(<Stat key="a" label="Attendance, last 7 days" value={r.rate === null ? "No registers yet" : `${r.rate}%`} href={`${base}/attendance`} />);
  }
  if (can(ctx, "admissions.manage")) stats.push(<Stat key="ad" label="Applications awaiting review" value={(await listApplications(ctx, "submitted")).length} href={`${base}/admissions`} />);
  if (can(ctx, "reports.approve")) stats.push(<Stat key="r" label="Reports to approve or publish" value={(await submittedReports(ctx)).length} href={`${base}/reports`} />);
  if (can(ctx, "discipline.decide")) stats.push(<Stat key="d" label="Discipline reports to decide" value={(await listIncidents(ctx, "reported")).length} href={`${base}/discipline`} />);
  if (can(ctx, "leave.review")) stats.push(<Stat key="l" label="Leave requests pending" value={(await listLeave(ctx)).filter((l) => l.l.status === "pending").length} href={`${base}/staff/leave`} />);
  if (can(ctx, "fees.manage")) stats.push(<Stat key="p" label="Proofs of payment to verify" value={(await listProofs(ctx, "pending")).length} href={`${base}/fees/proofs`} />);
  if (can(ctx, "fees.view_all")) {
    for (const t of await feeTotals(ctx)) stats.push(<Stat key={`f${t.currency}`} label={`Outstanding (${t.currency})`} value={money(t.charged - t.paid, t.currency)} href={`${base}/fees`} />);
  }
  if (can(ctx, "library.manage")) stats.push(<Stat key="lib" label="Overdue library books" value={(await openLoans(ctx, true)).length} href={`${base}/library`} />);
  if (can(ctx, "attendance.take")) {
    const regs = await myRegisters(ctx);
    stats.push(<Stat key="reg" label="My classes and groups" value={regs.classes.length + regs.groups.length} href={`${base}/attendance`} />);
  }
  if (can(ctx, "messages.staff") || can(ctx, "portal.guardian")) {
    const open = (await myThreads(ctx)).filter((t) => t.t.status === "open").length;
    stats.push(<Stat key="m" label="Open conversations" value={open} href={`${base}/messages`} />);
  }

  const children = can(ctx, "portal.guardian") ? await myChildren(ctx) : [];
  const learning = can(ctx, "portal.student") ? await myLearning(ctx) : null;

  return (
    <>
      <PageHeader title={`Welcome, ${ctx.user.name.split(" ")[0]}`} description={[year?.name, term?.name].filter(Boolean).join(" · ") || "No academic year set up yet"} />
      {stats.length ? <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{stats}</div> : null}

      {children.length ? (
        <Card className="mb-6">
          <h2 className="mb-2 font-semibold">My children</h2>
          <ul className="divide-y divide-slate-100">
            {children.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`${base}/students/${c.id}`} className="font-medium text-brand-700 underline">{c.firstName} {c.lastName}</Link>
                <span className="flex gap-3 text-sm">
                  <Link className="underline" href={`${base}/students/${c.id}?tab=attendance`}>Attendance</Link>
                  <Link className="underline" href={`${base}/students/${c.id}?tab=results`}>Progress</Link>
                  <Link className="underline" href={`${base}/fees/student/${c.id}`}>Fees</Link>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {learning ? (
        <Card className="mb-6">
          <h2 className="mb-2 font-semibold">Upcoming work</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {learning.work.filter((w) => w.a.dueOn && w.a.dueOn >= new Date().toISOString().slice(0, 10)).slice(0, 6).map((w) => (
              <li key={w.a.id} className="flex justify-between gap-2"><span>{w.a.title}</span><span className="text-slate-600">due {fmtDate(w.a.dueOn)} <Badge>{w.status ?? "pending"}</Badge></span></li>
            ))}
          </ul>
          <Link href={`${base}/learning`} className="mt-2 inline-block text-sm text-brand-700 underline">All my learning</Link>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Announcements</h2>
          {announcements.length ? (
            <ul className="flex flex-col gap-3">
              {announcements.map((a) => (
                <li key={a.a.id}>
                  <p className="font-medium">{a.a.title}</p>
                  <p className="line-clamp-2 text-sm text-slate-600">{a.a.body}</p>
                  <p className="text-xs text-slate-500">{fmtDateTime(a.a.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">No announcements.</p>}
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Upcoming events</h2>
          {events.length ? (
            <ul className="flex flex-col gap-2">
              {events.map((e) => (
                <li key={e.id} className="text-sm"><span className="font-medium">{e.title}</span> <span className="text-slate-600">· {fmtDateTime(e.startsAt)}{e.location ? ` · ${e.location}` : ""}</span></li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Nothing scheduled.</p>}
        </Card>
      </div>
    </>
  );
}
