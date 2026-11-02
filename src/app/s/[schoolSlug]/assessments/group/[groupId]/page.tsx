import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { assertTeachesGroup, groupMaterials, listAssessments } from "@/modules/assessments/service";
import { currentTerm, listTerms } from "@/modules/setup/service";
import { ForbiddenError } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Checkbox, Details, Flash, fmtDate, Grid, Input, Section, Select, SubmitButton, Table, TextArea } from "@/ui/kit";
import { addMaterial, createAssessment } from "../../../_actions/academic";
import { load, str } from "../../../_lib";

export const metadata: Metadata = { title: "Teaching group" };

export default async function GroupAssessments(props: PageProps<"/s/[schoolSlug]/assessments/group/[groupId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  let g;
  try { g = await assertTeachesGroup(ctx, params.groupId); } catch (e) { if (e instanceof ForbiddenError || (e instanceof Error && e.name === "UserError")) notFound(); throw e; }
  const terms = (await listTerms(ctx, g.academicYearId));
  const termId = str(sp.term) || (await currentTerm(ctx))?.id || terms[0]?.id;
  const [rows, materials] = await Promise.all([listAssessments(ctx, g.id, termId), groupMaterials(ctx, g.id)]);
  const totalWeight = rows.reduce((s, r) => s + (r.a.weight ?? 0), 0);
  const here = `${base}/assessments/group/${g.id}?term=${termId ?? ""}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/assessments`} className="text-brand-700 underline">← Assessments</Link></p>
      <PageHeader title={g.name} description={`Weights used this term: ${totalWeight}% of 100%`} />
      <Flash sp={sp} />
      <form className="mb-4 flex items-end gap-2" action={`${base}/assessments/group/${g.id}`}>
        <Select label="Term" name="term" defaultValue={termId} options={terms.map((t) => ({ value: t.id, label: t.name }))} />
        <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button>
      </form>
      <Table caption="Assessments" rows={rows} rowKey={(r) => r.a.id} empty="No assessments this term." columns={[
        { header: "Title", cell: (r) => <Link className="font-medium text-brand-700 underline" href={`${base}/assessments/${r.a.id}`}>{r.a.title}</Link> },
        { header: "Kind", cell: (r) => r.a.kind.toUpperCase() === "CALA" ? "CALA" : r.a.kind },
        { header: "Weight", cell: (r) => (r.a.weight ? `${r.a.weight}%` : "feedback only") },
        { header: "Due", cell: (r) => fmtDate(r.a.dueOn), hideOnMobile: true },
        { header: "Marked", cell: (r) => r.marked },
        { header: "Approved", cell: (r) => r.approved, hideOnMobile: true },
        { header: "Status", cell: (r) => <Badge>{r.a.status}</Badge>, hideOnMobile: true },
      ]} />
      {termId ? (
        <Details summary="New assessment, assignment or coursework">
          <ActionForm action={createAssessment.bind(null, slug)} back={here}>
            <input type="hidden" name="groupId" value={g.id} /><input type="hidden" name="termId" value={termId} />
            <Grid>
              <Input label="Title" name="title" required />
              <Select label="Kind" name="kind" options={["classwork", "assignment", "test", "exam", "coursework", "cala", "practical"].map((k) => ({ value: k, label: k === "cala" ? "CALA" : k }))} />
              <Input label="Out of (maximum score)" name="maxScore" type="number" step="0.5" min={1} required />
              <Input label="Weight in term result (%)" name="weight" type="number" step="0.5" min={0} max={100} hint="Leave blank for feedback-only work that does not count." />
              <Input label="Due date" name="dueOn" type="date" />
            </Grid>
            <TextArea label="Instructions" name="instructions" />
            <Checkbox label="Students can submit work online" name="acceptsSubmissions" />
            <div><SubmitButton>Create</SubmitButton></div>
          </ActionForm>
        </Details>
      ) : <p className="text-sm text-slate-600">Set up terms first (Setup &gt; Years &amp; terms).</p>}
      <Section title="Learning materials">
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {materials.map((m) => <li key={m.m.id}>{m.m.title} {m.m.fileId ? <a className="text-brand-700 underline" href={`${base}/files/${m.m.fileId}`}>({m.fileName})</a> : null} {m.m.link ? <a className="text-brand-700 underline" href={m.m.link} rel="noopener noreferrer">link</a> : null}</li>)}
          {!materials.length ? <li className="text-slate-500">None shared yet.</li> : null}
        </ul>
        <Details summary="Share a material">
          <ActionForm action={addMaterial.bind(null, slug)} back={here} upload>
            <input type="hidden" name="groupId" value={g.id} />
            <Grid><Input label="Title" name="title" required /><Input label="Link (https://…)" name="link" type="url" /></Grid>
            <TextArea label="Description" name="description" />
            <input type="file" name="file" accept="application/pdf,image/*" aria-label="File" className="text-sm" />
            <p className="text-xs text-slate-500">PDF or image, up to 5 MB. Keep files small for students on mobile data.</p>
            <div><SubmitButton>Share with the group</SubmitButton></div>
          </ActionForm>
        </Details>
      </Section>
    </>
  );
}
