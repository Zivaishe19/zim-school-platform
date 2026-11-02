import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarksheet } from "@/modules/assessments/service";
import { can, ForbiddenError } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Flash, SubmitButton } from "@/ui/kit";
import { approveMarks, publishMarks, saveMarks } from "../../_actions/academic";
import { load } from "../../_lib";

export const metadata: Metadata = { title: "Marksheet" };

export default async function Marksheet(props: PageProps<"/s/[schoolSlug]/assessments/[assessmentId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  let m;
  try { m = await getMarksheet(ctx, params.assessmentId); } catch (e) { if (e instanceof ForbiddenError || (e instanceof Error && ["UserError", "ZodError"].includes(e.name))) notFound(); throw e; }
  const a = m.assessment;
  const here = `${base}/assessments/${a.id}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/assessments/group/${a.teachingGroupId}`} className="text-brand-700 underline">← {m.group.name}</Link></p>
      <PageHeader title={a.title} description={`${a.kind} · out of ${a.maxScore} · ${a.weight ? `${a.weight}% of term` : "feedback only"}${a.dueOn ? ` · due ${a.dueOn}` : ""}`} />
      <Flash sp={sp} />
      {a.instructions ? <p className="mb-3 text-sm whitespace-pre-line">{a.instructions}</p> : null}
      <p className="mb-3 text-sm text-slate-600">Leave a score blank if it is still pending. Tick &ldquo;missing&rdquo; for work not handed in: missing is never treated as zero in results.</p>
      <ActionForm action={saveMarks.bind(null, slug)} back={here}>
        <input type="hidden" name="assessmentId" value={a.id} />
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <caption className="sr-only">Marks</caption>
            <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-2">Student</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Missing</th><th className="px-3 py-2">Comment</th><th className="px-3 py-2">Status</th></tr></thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r.lastName}, {r.firstName}{r.submission ? <span className="block text-xs">{r.submission.fileId ? <a className="text-brand-700 underline" href={`${base}/files/${r.submission.fileId}`}>submitted file</a> : null}{r.submission.text ? <span className="text-slate-600"> · {r.submission.text.slice(0, 80)}</span> : null}</span> : null}</td>
                  <td className="px-3 py-2"><input name={`score_${r.id}`} defaultValue={r.score ?? ""} inputMode="decimal" aria-label={`Score for ${r.firstName}`} className="min-h-10 w-20 rounded border border-slate-300 px-2" /></td>
                  <td className="px-3 py-2"><input type="checkbox" name={`missing_${r.id}`} defaultChecked={r.status === "missing"} aria-label={`Missing for ${r.firstName}`} className="size-5" /></td>
                  <td className="px-3 py-2"><input name={`comment_${r.id}`} defaultValue={r.comment} aria-label={`Comment for ${r.firstName}`} className="min-h-10 w-full min-w-32 rounded border border-slate-300 px-2" /></td>
                  <td className="px-3 py-2"><Badge>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><SubmitButton>Save marks</SubmitButton></div>
      </ActionForm>
      {can(ctx, "marks.approve") ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <ActionForm action={approveMarks.bind(null, slug)} back={here} className="inline"><input type="hidden" name="assessmentId" value={a.id} /><SubmitButton variant="secondary">Approve marked scores</SubmitButton></ActionForm>
          <ActionForm action={publishMarks.bind(null, slug)} back={here} className="inline"><input type="hidden" name="assessmentId" value={a.id} /><SubmitButton variant="secondary" confirm="Publish approved marks to students and parents?">Publish approved marks</SubmitButton></ActionForm>
        </div>
      ) : <p className="mt-4 text-sm text-slate-600">Once marked, the headmaster approves and publishes marks. Approved marks can then only be corrected by the headmaster, with an audit record.</p>}
    </>
  );
}
