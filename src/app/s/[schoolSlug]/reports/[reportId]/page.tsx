import type { Metadata } from "next";
import Link from "next/link";
import { getReport } from "@/modules/reports/service";
import { getProfile } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { ActionForm, Badge, Flash, SubmitButton } from "@/ui/kit";
import { PrintButton } from "@/ui/print-button";
import { reopenReport } from "../../_actions/academic";
import { guard, load } from "../../_lib";

export const metadata: Metadata = { title: "Report card" };

export default async function ReportPage(props: PageProps<"/s/[schoolSlug]/reports/[reportId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  const r = await getReport(ctx, params.reportId);
  guard(r);
  const d = r.data;
  const profile = await getProfile(ctx);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`${base}/reports`} className="text-sm text-brand-700 underline">← Reports</Link>
        <span className="flex items-center gap-2"><Badge>{r.report.status}</Badge>{r.frozen ? <span className="text-xs text-slate-500">frozen at approval</span> : <span className="text-xs text-amber-700">live preview (not final)</span>}<PrintButton /></span>
      </div>
      <Flash sp={sp} />
      <article className="rounded-lg border border-slate-300 bg-white p-6 print:border-0 print:p-0">
        <header className="mb-4 border-b border-slate-300 pb-3 text-center">
          <h1 className="text-xl font-bold">{profile.displayName}</h1>
          {profile.motto ? <p className="text-sm italic">{profile.motto}</p> : null}
          <p className="mt-1 text-sm">{[profile.address, profile.phone, profile.email].filter(Boolean).join(" · ")}</p>
          <h2 className="mt-3 text-lg font-semibold">Report card · {d.term.name}</h2>
        </header>
        <dl className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Student</dt><dd className="font-semibold">{d.student.name}</dd></div>
          <div><dt className="text-slate-500">Admission no.</dt><dd>{d.student.admissionNumber}</dd></div>
          <div><dt className="text-slate-500">Class</dt><dd>{d.className}</dd></div>
          <div><dt className="text-slate-500">Term</dt><dd>{d.term.startsOn} – {d.term.endsOn}</dd></div>
        </dl>
        <table className="mb-4 w-full text-sm">
          <thead><tr className="border-b border-slate-300 text-left"><th className="py-1 pr-2">Subject</th><th className="pr-2">Teacher</th><th className="pr-3 text-right">Mark</th><th className="text-center">Grade</th></tr></thead>
          <tbody>
            {d.subjects.map((s) => (
              <tr key={s.subject} className="border-b border-slate-100">
                <td className="py-1 pr-2">{s.subject}</td><td className="pr-2">{s.teacher ?? ""}</td>
                <td className="pr-3 text-right whitespace-nowrap">{s.percent === null ? "—" : `${s.percent}%`}{s.incomplete ? " *" : ""}</td><td className="text-center font-semibold">{s.grade ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.subjects.some((s) => s.incomplete) ? <p className="mb-3 text-xs text-slate-600">* Some weighted work had no mark (missing or pending). Missing work is not counted as zero.</p> : null}
        <p className="mb-3 text-sm"><strong>Attendance:</strong> {d.attendance.present + d.attendance.late} of {d.attendance.days} days present ({d.attendance.late} late), {d.attendance.absent} absent, {d.attendance.approved} approved absence.</p>
        <p className="mb-2 text-sm"><strong>Class teacher:</strong> {d.classTeacherComment ?? "—"}</p>
        <p className="text-sm"><strong>Headmaster:</strong> {d.headComment ?? "—"}</p>
      </article>
      {can(ctx, "reports.approve") && (r.report.status === "approved" || r.report.status === "published") ? (
        <ActionForm action={reopenReport.bind(null, slug)} back={`${base}/reports/${r.report.id}`} className="mt-6 flex flex-wrap items-end gap-2 print:hidden">
          <input type="hidden" name="reportId" value={r.report.id} />
          <label className="flex flex-col text-sm">Reason for correction<input name="reason" required minLength={5} className="min-h-10 w-72 rounded border border-slate-300 px-2" /></label>
          <SubmitButton variant="secondary" confirm="Reopen this report? The current version is kept in the audit log.">Reopen for correction</SubmitButton>
        </ActionForm>
      ) : null}
    </>
  );
}
