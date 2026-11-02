import type { Metadata } from "next";
import { myLearning } from "@/modules/assessments/service";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Details, Flash, fmtDate, Section, SubmitButton, TextArea } from "@/ui/kit";
import { submitWork } from "../_actions/academic";
import { guard, load } from "../_lib";

export const metadata: Metadata = { title: "My learning" };

export default async function LearningPage(props: PageProps<"/s/[schoolSlug]/learning">) {
  const { ctx, sp, base, slug } = await load(props);
  const l = await myLearning(ctx);
  guard(l);
  return (
    <>
      <PageHeader title="My learning" description={l.groups.map((g) => g.subject).join(" · ") || "No subjects yet"} />
      <Flash sp={sp} />
      <Section title="Assignments and assessments">
        {l.work.map((w) => (
          <Card key={w.a.id} className="mb-3">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-semibold">{w.a.title}</h3>
              <span className="text-sm">{w.a.dueOn ? `due ${fmtDate(w.a.dueOn)} ` : ""}<Badge>{w.status ?? "pending"}</Badge>{w.score !== null && w.score !== undefined ? <strong className="ml-2">{w.score}/{w.a.maxScore}</strong> : null}</span>
            </div>
            {w.a.instructions ? <p className="mt-1 text-sm whitespace-pre-line text-slate-700">{w.a.instructions}</p> : null}
            {w.a.acceptsSubmissions && w.a.status !== "closed" && w.status !== "published" ? (
              <Details summary={w.submittedAt ? "Submit again (replaces your earlier work)" : "Submit work"}>
                <ActionForm action={submitWork.bind(null, slug)} back={`${base}/learning`} upload>
                  <input type="hidden" name="assessmentId" value={w.a.id} />
                  <TextArea label="Your answer (optional if you attach a file)" name="text" />
                  <input type="file" name="file" accept="application/pdf,image/*" aria-label="Attach file" className="text-sm" />
                  <div><SubmitButton>Submit</SubmitButton></div>
                </ActionForm>
              </Details>
            ) : null}
          </Card>
        ))}
        {!l.work.length ? <p className="text-sm text-slate-500">No work set yet.</p> : null}
      </Section>
      <Section title="Learning materials">
        <ul className="flex flex-col gap-2 text-sm">
          {l.materials.map((m) => <li key={m.m.id} className="rounded border border-slate-200 bg-white px-3 py-2"><span className="font-medium">{m.m.title}</span>{m.m.description ? <span className="block text-slate-600">{m.m.description}</span> : null}{m.m.fileId ? <a className="text-brand-700 underline" href={`${base}/files/${m.m.fileId}`}>Download {m.fileName}</a> : null} {m.m.link ? <a className="text-brand-700 underline" href={m.m.link} rel="noopener noreferrer">Open link</a> : null}</li>)}
          {!l.materials.length ? <li className="text-slate-500">Nothing shared yet.</li> : null}
        </ul>
      </Section>
    </>
  );
}
