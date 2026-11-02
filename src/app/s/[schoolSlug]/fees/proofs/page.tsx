import type { Metadata } from "next";
import Link from "next/link";
import { listProofs } from "@/modules/fees/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Flash, money, Tabs } from "@/ui/kit";
import { reviewProof } from "../../_actions/admin";
import { guard, load, str } from "../../_lib";

export const metadata: Metadata = { title: "Proofs of payment" };
const STATUSES = ["pending", "info_requested", "verified", "rejected"] as const;

export default async function ProofsPage(props: PageProps<"/s/[schoolSlug]/fees/proofs">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "fees.manage"));
  const st = STATUSES.find((s) => s === str(sp.status)) ?? "pending";
  const rows = await listProofs(ctx, st);
  const here = `${base}/fees/proofs?status=${st}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/fees`} className="text-brand-700 underline">← Fees</Link></p>
      <PageHeader title="Proofs of payment" description="A proof never credits an account by itself. Check it against the bank or EcoCash statement first." />
      <Flash sp={sp} />
      <Tabs current={here} items={STATUSES.map((s) => ({ href: `${base}/fees/proofs?status=${s}`, label: s.replace("_", " ") }))} />
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.p.id}><Card>
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium"><Link className="text-brand-700 underline" href={`${base}/fees/student/${r.p.studentId}`}>{r.last}, {r.first}</Link> ({r.adm})</span>
              <a className="text-sm text-brand-700 underline" href={`${base}/files/${r.p.fileId}`}>Open proof ({r.fileName})</a>
            </div>
            <p className="text-sm">{money(r.p.amountCents, r.p.currency)} · {r.p.channel} · ref <span className="font-mono">{r.p.reference}</span> · paid {r.p.paidOn}</p>
            {r.p.comment ? <p className="text-sm text-slate-600">Parent: {r.p.comment}</p> : null}
            {r.p.reviewNote ? <p className="text-sm text-slate-600">Note: {r.p.reviewNote}</p> : null}
            {st === "pending" || st === "info_requested" ? (
              <ActionForm action={reviewProof.bind(null, slug)} back={here} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="proofId" value={r.p.id} />
                <label className="flex flex-col text-sm">Amount received<input name="amount" defaultValue={(r.p.amountCents / 100).toFixed(2)} inputMode="decimal" className="min-h-10 w-28 rounded border border-slate-300 px-2" /></label>
                <label className="flex flex-col text-sm">Note to parent<input name="note" className="min-h-10 w-56 rounded border border-slate-300 px-2" /></label>
                <button name="decision" value="verified" className="min-h-10 rounded bg-brand-600 px-3 text-sm font-semibold text-white">Verify and credit</button>
                <button name="decision" value="info_requested" className="min-h-10 rounded border border-slate-300 px-3 text-sm">Ask for more information</button>
                <button name="decision" value="rejected" className="min-h-10 rounded border border-red-300 px-3 text-sm text-red-800">Reject</button>
              </ActionForm>
            ) : null}
          </Card></li>
        ))}
        {!rows.length ? <li className="text-sm text-slate-500">Nothing here.</li> : null}
      </ul>
    </>
  );
}
