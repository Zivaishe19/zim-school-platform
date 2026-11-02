import type { Metadata } from "next";
import Link from "next/link";
import { feeTotals, listFeeItems, outstanding } from "@/modules/fees/service";
import { listForms, listTerms } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { myChildren } from "@/server/tenancy/scope";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Details, Flash, Grid, Input, money, Section, Select, SubmitButton, Table } from "@/ui/kit";
import { applyFeeItem, createFeeItem } from "../_actions/admin";
import { guard, load } from "../_lib";

export const metadata: Metadata = { title: "Fees" };

export default async function FeesPage(props: PageProps<"/s/[schoolSlug]/fees">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "fees.manage") || can(ctx, "fees.view_all") || can(ctx, "portal.guardian"));
  if (!can(ctx, "fees.view_all")) {
    const kids = await myChildren(ctx);
    return (
      <>
        <PageHeader title="Fees" description="Statements for your children. Upload proof of payment from a child's statement." />
        <ul className="flex flex-col gap-2">{kids.map((k) => <li key={k.id}><Link className="block rounded-lg border border-slate-200 bg-white px-4 py-3 font-medium text-brand-700" href={`${base}/fees/student/${k.id}`}>{k.firstName} {k.lastName}</Link></li>)}</ul>
      </>
    );
  }
  const [totals, owing, items, terms, forms] = await Promise.all([feeTotals(ctx), outstanding(ctx), listFeeItems(ctx), listTerms(ctx), listForms(ctx)]);
  return (
    <>
      <PageHeader title="Fees" description="USD and ZiG balances are kept separately and never converted." actions={can(ctx, "fees.manage") ? <Link className="text-sm text-brand-700 underline" href={`${base}/fees/proofs`}>Proofs of payment</Link> : null} />
      <Flash sp={sp} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {totals.map((t) => <Card key={t.currency}><p className="text-sm text-slate-600">{t.currency}</p><p className="text-sm">Charged {money(t.charged, t.currency)} · Paid {money(t.paid, t.currency)}</p><p className="text-xl font-semibold">Outstanding {money(t.charged - t.paid, t.currency)}</p></Card>)}
        {!totals.length ? <p className="text-sm text-slate-500">No charges yet.</p> : null}
      </div>
      <Section title="Fee structure">
        <Table caption="Fee items" rows={items} rowKey={(r) => r.f.id} empty="No fee items yet." columns={[
          { header: "Item", cell: (r) => r.f.name }, { header: "Amount", cell: (r) => money(r.f.amountCents, r.f.currency) },
          { header: "Applies to", cell: (r) => `${r.f.formLevel ? `Form level ${r.f.formLevel}` : "All forms"}${r.termName ? ` · ${r.termName}` : ""}` },
          ...(can(ctx, "fees.manage") ? [{ header: "", cell: (r: (typeof items)[number]) => <ActionForm action={applyFeeItem.bind(null, slug)} back={`${base}/fees`} className="inline"><input type="hidden" name="feeItemId" value={r.f.id} /><SubmitButton variant="secondary" confirm="Charge this fee to every enrolled student it applies to? Students already charged are skipped.">Charge students</SubmitButton></ActionForm> }] : []),
        ]} />
        {can(ctx, "fees.manage") ? (
          <Details summary="Add a fee item">
            <ActionForm action={createFeeItem.bind(null, slug)} back={`${base}/fees`}>
              <Grid>
                <Input label="Name" name="name" placeholder="Term 1 tuition" required />
                <Input label="Amount" name="amount" inputMode="decimal" placeholder="250.00" required />
                <Select label="Currency" name="currency" options={[{ value: "USD", label: "USD" }, { value: "ZiG", label: "ZiG" }]} />
                <Select label="Term" name="termId" placeholder="—" options={terms.map((t) => ({ value: t.id, label: `${t.name} (${t.startsOn.slice(0, 4)})` }))} />
                <Select label="Only for form" name="formLevel" placeholder="All forms" options={forms.map((f) => ({ value: String(f.level), label: f.name }))} />
              </Grid>
              <div><SubmitButton>Add fee item</SubmitButton></div>
            </ActionForm>
          </Details>
        ) : null}
      </Section>
      <Section title={`Outstanding balances (${owing.length})`}>
        <Table caption="Outstanding" rows={owing} rowKey={(r) => `${r.studentId}${r.currency}`} empty="Nobody owes anything." columns={[
          { header: "Student", cell: (r) => <Link className="text-brand-700 underline" href={`${base}/fees/student/${r.studentId}`}>{r.last}, {r.first}</Link> },
          { header: "Admission no.", cell: (r) => r.adm, hideOnMobile: true },
          { header: "Balance", cell: (r) => <Badge tone="amber">{money(r.balance, r.currency)}</Badge> },
        ]} />
      </Section>
    </>
  );
}
