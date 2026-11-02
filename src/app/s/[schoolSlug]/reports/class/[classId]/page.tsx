import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { classReports } from "@/modules/reports/service";
import { listTerms } from "@/modules/setup/service";
import { can, ForbiddenError } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Flash, Select } from "@/ui/kit";
import { teacherComment } from "../../../_actions/academic";
import { load, str } from "../../../_lib";

export const metadata: Metadata = { title: "Class reports" };

export default async function ClassReports(props: PageProps<"/s/[schoolSlug]/reports/class/[classId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  const terms = await listTerms(ctx);
  const termId = str(sp.term) || terms.at(-1)?.id || "";
  let rows;
  try { rows = await classReports(ctx, params.classId, termId); } catch (e) { if (e instanceof ForbiddenError) notFound(); throw e; }
  const here = `${base}/reports/class/${params.classId}?term=${termId}`;
  const editable = can(ctx, "reports.prepare");
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/reports`} className="text-brand-700 underline">← Reports</Link></p>
      <PageHeader title="Class report cards" description={`${rows.length} students`} />
      <Flash sp={sp} />
      <form className="mb-4 flex items-end gap-2" action={`${base}/reports/class/${params.classId}`}>
        <Select label="Term" name="term" defaultValue={termId} options={terms.map((t) => ({ value: t.id, label: `${t.name} (${t.startsOn.slice(0, 4)})` }))} />
        <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button>
      </form>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const locked = r.report && (r.report.status === "approved" || r.report.status === "published");
          return (
            <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{r.lastName}, {r.firstName}</span>
                <span className="flex items-center gap-2 text-sm">
                  <Badge>{r.report?.status ?? "not started"}</Badge>
                  {r.report ? <Link className="text-brand-700 underline" href={`${base}/reports/${r.report.id}`}>View</Link> : null}
                </span>
              </div>
              {editable && !locked ? (
                <ActionForm action={teacherComment.bind(null, slug)} back={here} className="flex flex-col gap-2">
                  <input type="hidden" name="studentId" value={r.id} /><input type="hidden" name="termId" value={termId} /><input type="hidden" name="classId" value={params.classId} />
                  <label className="sr-only" htmlFor={`c-${r.id}`}>Class teacher comment</label>
                  <textarea id={`c-${r.id}`} name="comment" rows={2} defaultValue={r.report?.classTeacherComment ?? ""} placeholder="Class teacher's comment" className="rounded border border-slate-300 p-2" />
                  <div className="flex gap-2">
                    <button className="rounded border border-slate-300 px-3 py-2 text-sm">Save draft</button>
                    <button name="submit" value="1" className="rounded bg-brand-600 px-3 py-2 text-sm font-semibold text-white">Submit for approval</button>
                  </div>
                </ActionForm>
              ) : r.report?.classTeacherComment ? <p className="text-sm text-slate-700">{r.report.classTeacherComment}</p> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
