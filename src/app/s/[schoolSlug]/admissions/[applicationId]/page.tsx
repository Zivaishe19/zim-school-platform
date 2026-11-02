import type { Metadata } from "next";
import Link from "next/link";
import { getApplication } from "@/modules/admissions/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Checkbox, Flash, Grid, Input, Section, Select, SubmitButton, Table, TextArea } from "@/ui/kit";
import { addDocument, decide } from "../../_actions/admissions";
import { guard, load } from "../../_lib";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationPage(props: PageProps<"/s/[schoolSlug]/admissions/[applicationId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  guard(can(ctx, "admissions.manage"));
  const a = await getApplication(ctx, params.applicationId);
  guard(a);
  const here = `${base}/admissions/${a.id}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/admissions`} className="text-brand-700 underline">← Admissions</Link></p>
      <PageHeader title={`${a.firstName} ${a.lastName}`} description={`${a.reference} · ${a.source.replace("_", " ")}`} />
      <Flash sp={sp} />
      <Card className="mb-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">Status</dt><dd><Badge>{a.status}</Badge></dd></div>
          <div><dt className="text-slate-500">Applying for</dt><dd>{a.applyingForLevel <= 4 ? `Form ${a.applyingForLevel}` : a.applyingForLevel === 5 ? "Lower Six" : "Upper Six"} ({a.entryType})</dd></div>
          <div><dt className="text-slate-500">Date of birth</dt><dd>{a.dateOfBirth ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Previous school</dt><dd>{a.previousSchool ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Guardian</dt><dd>{a.guardianName} · {a.guardianPhone}{a.guardianEmail ? ` · ${a.guardianEmail}` : ""}</dd></div>
          {a.studentId ? <div><dt className="text-slate-500">Student record</dt><dd><Link className="text-brand-700 underline" href={`${base}/students/${a.studentId}`}>Open</Link></dd></div> : null}
        </dl>
        {a.decisionNote ? <p className="mt-3 text-sm">Note: {a.decisionNote}</p> : null}
      </Card>
      {a.nextStatuses.length ? (
        <Section title="Decision">
          <Card>
            <ActionForm action={decide.bind(null, slug)} back={here}>
              <input type="hidden" name="applicationId" value={a.id} />
              <Grid>
                <Select label="Move to" name="status" options={a.nextStatuses.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
                <Input label="Admission number (when accepting)" name="admissionNumber" placeholder="KH/2027/0001" />
              </Grid>
              <TextArea label="Note (shown to staff; say what is needed when requesting information)" name="note" />
              <p className="text-sm text-slate-600">Accepting creates a registered student record. It does not enrol them in a class; do that from Setup &gt; Classes.</p>
              <div><SubmitButton>Save decision</SubmitButton></div>
            </ActionForm>
          </Card>
        </Section>
      ) : null}
      <Section title="Documents">
        <Table caption="Documents" rows={a.documents} rowKey={(d) => d.id} empty="No documents yet." columns={[
          { header: "Document", cell: (d) => <a className="text-brand-700 underline" href={`${base}/files/${d.fileId}`}>{d.kind}</a> },
          { header: "File", cell: (d) => d.name },
          { header: "Original seen", cell: (d) => (d.physical ? "Yes" : "") },
        ]} />
        <Card className="mt-3">
          <ActionForm action={addDocument.bind(null, slug)} back={here} upload>
            <input type="hidden" name="applicationId" value={a.id} />
            <Grid>
              <Input label="Document type" name="kind" placeholder="Birth certificate, Grade 7 results, transfer letter" required />
              <input type="file" name="file" accept="application/pdf,image/*" required aria-label="Document file" className="text-sm" />
            </Grid>
            <Checkbox label="Original was seen at the school" name="physical" />
            <div><SubmitButton variant="secondary">Upload document</SubmitButton></div>
          </ActionForm>
        </Card>
      </Section>
    </>
  );
}
