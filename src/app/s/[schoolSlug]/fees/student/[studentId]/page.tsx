import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CHANNELS, statement } from "@/modules/fees/service";
import { getStudent } from "@/modules/students/service";
import { can, ForbiddenError } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Details, Flash, Grid, Input, money, Section, Select, SubmitButton, Table, TextArea, today } from "@/ui/kit";
import { addCharge, recordPayment, reverse, submitProof } from "../../../_actions/admin";
import { load } from "../../../_lib";

export const metadata: Metadata = { title: "Fees statement" };
const cur = [{ value: "USD", label: "USD" }, { value: "ZiG", label: "ZiG" }];
const chan = CHANNELS.map((c) => ({ value: c, label: c === "ecocash" ? "EcoCash" : c }));

export default async function StatementPage(props: PageProps<"/s/[schoolSlug]/fees/student/[studentId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  let st;
  try { st = await statement(ctx, params.studentId); } catch (e) { if (e instanceof ForbiddenError) notFound(); throw e; }
  const s = await getStudent(ctx, params.studentId).catch(() => null);
  if (!s) notFound();
  const here = `${base}/fees/student/${s.id}`;
  const manage = can(ctx, "fees.manage");
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/fees`} className="text-brand-700 underline">← Fees</Link></p>
      <PageHeader title={`Fees: ${s.firstName} ${s.lastName}`} description={s.admissionNumber} />
      <Flash sp={sp} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {Object.entries(st.balances).map(([c, b]) => <Card key={c}><p className="text-sm text-slate-600">Balance ({c})</p><p className="text-2xl font-semibold">{b > 0 ? money(b, c) : b < 0 ? `${money(-b, c)} in credit` : `${c} 0.00`}</p></Card>)}
        {!Object.keys(st.balances).length ? <p className="text-sm text-slate-500">No fees recorded.</p> : null}
      </div>
      <Section title="Statement">
        <Table caption="Statement" rows={st.entries} rowKey={(e) => e.id} empty="No entries." columns={[
          { header: "Date", cell: (e) => e.occurredOn },
          { header: "Description", cell: (e) => <span className={e.reversedAt ? "line-through" : ""}>{e.description}{e.reference ? ` (ref ${e.reference})` : ""}</span> },
          { header: "Charge", cell: (e) => (e.kind === "charge" ? money(e.amountCents, e.currency) : "") },
          { header: "Payment", cell: (e) => (e.kind === "payment" ? money(e.amountCents, e.currency) : "") },
          { header: "", cell: (e) => e.reversedAt ? <span className="text-xs text-slate-600">Reversed: {e.reversalReason}</span> : manage ? (
            <ActionForm action={reverse.bind(null, slug)} back={here} className="flex gap-1">
              <input type="hidden" name="entryId" value={e.id} />
              <input name="reason" placeholder="reason" aria-label="Reason for reversal" required minLength={5} className="min-h-9 w-28 rounded border border-slate-300 px-1 text-xs" />
              <button className="text-xs text-red-700 underline">Reverse</button>
            </ActionForm>
          ) : null },
        ]} />
      </Section>
      <Section title="Proofs of payment">
        <Table caption="Proofs" rows={st.proofs} rowKey={(p) => p.id} empty="None uploaded." columns={[
          { header: "Paid", cell: (p) => p.paidOn }, { header: "Amount", cell: (p) => money(p.amountCents, p.currency) },
          { header: "Reference", cell: (p) => `${p.channel} ${p.reference}` },
          { header: "Status", cell: (p) => <><Badge>{p.status}</Badge>{p.reviewNote ? <span className="block text-xs">{p.reviewNote}</span> : null}</> },
        ]} />
      </Section>
      {can(ctx, "portal.guardian") || manage ? (
        <Details summary="Upload proof of payment">
          <ActionForm action={submitProof.bind(null, slug)} back={here} upload>
            <input type="hidden" name="studentId" value={s.id} />
            <Grid>
              <Input label="Amount paid" name="amount" inputMode="decimal" required />
              <Select label="Currency" name="currency" options={cur} />
              <Select label="Paid by" name="channel" options={chan} />
              <Input label="Transaction reference" name="reference" required />
              <Input label="Date paid" name="paidOn" type="date" defaultValue={today()} max={today()} required />
            </Grid>
            <TextArea label="Comment" name="comment" />
            <input type="file" name="file" accept="application/pdf,image/*" required aria-label="Proof file" className="text-sm" />
            <p className="text-xs text-slate-500">Photo or PDF, up to 5 MB. Your balance changes only after the accounts office verifies it.</p>
            <div><SubmitButton>Send proof</SubmitButton></div>
          </ActionForm>
        </Details>
      ) : null}
      {manage ? (
        <>
          <Details summary="Record a payment received">
            <ActionForm action={recordPayment.bind(null, slug)} back={here}>
              <input type="hidden" name="studentId" value={s.id} />
              <Grid>
                <Input label="Amount" name="amount" inputMode="decimal" required />
                <Select label="Currency" name="currency" options={cur} />
                <Select label="Channel" name="channel" options={chan} />
                <Input label="Reference / receipt number" name="reference" required />
                <Input label="Date" name="occurredOn" type="date" defaultValue={today()} required />
                <Input label="Description" name="description" defaultValue="Payment" required />
              </Grid>
              <div><SubmitButton>Record payment</SubmitButton></div>
            </ActionForm>
          </Details>
          <Details summary="Add a charge">
            <ActionForm action={addCharge.bind(null, slug)} back={here}>
              <input type="hidden" name="studentId" value={s.id} />
              <Grid>
                <Input label="Description" name="description" required />
                <Input label="Amount" name="amount" inputMode="decimal" required />
                <Select label="Currency" name="currency" options={cur} />
                <Input label="Date" name="occurredOn" type="date" defaultValue={today()} required />
              </Grid>
              <div><SubmitButton>Add charge</SubmitButton></div>
            </ActionForm>
          </Details>
        </>
      ) : null}
    </>
  );
}
