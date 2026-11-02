import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { enrolment, feeItem, fileObject, form, ledgerEntry, paymentProof, schoolClass, student, studentGuardian, term } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { storeUpload } from "@/server/files/storage";
import { assertCan, can, ForbiddenError, type SchoolContext } from "@/server/tenancy/context";
import { notify, peopleWithRoles } from "@/modules/comms/notify";

export const CURRENCIES = ["USD", "ZiG"] as const;
export const CHANNELS = ["bank", "ecocash", "cash", "other"] as const;

/** "12.50" -> 1250. Rejects negatives and more than 2 decimals. */
export function toCents(v: unknown): number {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new UserError("Enter an amount like 120 or 120.50");
  return Math.round(Number(s) * 100);
}

async function isGuardianOf(ctx: SchoolContext, studentId: string) {
  if (!ctx.personId) return false;
  return (await ctx.db.select().from(studentGuardian).where(and(eq(studentGuardian.studentId, studentId), eq(studentGuardian.guardianPersonId, ctx.personId)))).length > 0;
}

/** Accounts/headmaster see all; a parent sees only their own children's accounts. */
async function assertMaySeeFees(ctx: SchoolContext, studentId: string) {
  if (can(ctx, "fees.view_all")) return;
  if (!(await isGuardianOf(ctx, studentId))) throw new ForbiddenError("fees.view_all");
}

// ------------------------------------------------------------------ fee structure
export async function listFeeItems(ctx: SchoolContext) {
  return ctx.db.select({ f: feeItem, termName: term.name }).from(feeItem).leftJoin(term, eq(term.id, feeItem.termId)).orderBy(desc(feeItem.active), asc(feeItem.name));
}

export async function createFeeItem(ctx: SchoolContext, raw: Record<string, unknown>) {
  assertCan(ctx, "fees.manage");
  const v = z
    .object({ name: z.string().trim().min(2).max(120), currency: z.enum(CURRENCIES), termId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)), formLevel: z.coerce.number().int().min(1).max(6).optional().or(z.literal("").transform(() => undefined)) })
    .parse(raw);
  await ctx.db.insert(feeItem).values({ name: v.name, amountCents: toCents(raw.amount), currency: v.currency, termId: v.termId ?? null, formLevel: v.formLevel ?? null });
  await recordSchoolAudit(ctx.db, ctx, "fees.item_created", { type: "fee_item", id: v.name });
}

/**
 * Charges a fee item to every actively enrolled student it applies to (its form level, or all).
 * Idempotent: a student already charged this item (not reversed) is skipped.
 */
export async function applyFeeItem(ctx: SchoolContext, feeItemId: string) {
  assertCan(ctx, "fees.manage");
  const [f] = await ctx.db.select().from(feeItem).where(eq(feeItem.id, z.string().uuid().parse(feeItemId)));
  if (!f) throw new UserError("Fee item not found.");
  const targets = await ctx.db
    .selectDistinct({ id: enrolment.studentId })
    .from(enrolment)
    .innerJoin(schoolClass, eq(schoolClass.id, enrolment.classId))
    .innerJoin(form, eq(form.id, schoolClass.formId))
    .where(and(eq(enrolment.status, "active"), f.formLevel ? eq(form.level, f.formLevel) : undefined));
  const already = targets.length
    ? new Set((await ctx.db.select({ s: ledgerEntry.studentId }).from(ledgerEntry).where(and(eq(ledgerEntry.feeItemId, f.id), isNull(ledgerEntry.reversedAt)))).map((r) => r.s))
    : new Set<string>();
  const todo = targets.filter((t) => !already.has(t.id));
  if (todo.length) {
    await ctx.db.transaction(async (tx) => {
      for (let i = 0; i < todo.length; i += 500) {
        await tx.insert(ledgerEntry).values(
          todo.slice(i, i + 500).map((t) => ({ studentId: t.id, kind: "charge" as const, description: f.name, amountCents: f.amountCents, currency: f.currency, feeItemId: f.id, occurredOn: new Date().toISOString().slice(0, 10), recordedBy: ctx.user.id })),
        );
      }
      await recordSchoolAudit(tx, ctx, "fees.item_applied", { type: "fee_item", id: f.id }, { students: todo.length });
    });
  }
  return { charged: todo.length, skipped: targets.length - todo.length };
}

// ------------------------------------------------------------------ ledger
const entryInput = z.object({
  studentId: z.string().uuid(),
  currency: z.enum(CURRENCIES),
  description: z.string().trim().min(2).max(160),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  channel: z.enum(CHANNELS).optional(),
  reference: z.string().trim().max(80).optional(),
});

export async function addCharge(ctx: SchoolContext, raw: Record<string, unknown>) {
  assertCan(ctx, "fees.manage");
  const v = entryInput.parse(raw);
  await ctx.db.insert(ledgerEntry).values({ studentId: v.studentId, kind: "charge", description: v.description, amountCents: toCents(raw.amount), currency: v.currency, occurredOn: v.occurredOn, recordedBy: ctx.user.id });
  await recordSchoolAudit(ctx.db, ctx, "fees.charge_added", { type: "student", id: v.studentId });
}

export async function recordPayment(ctx: SchoolContext, raw: Record<string, unknown>, opts: { proofId?: string } = {}) {
  assertCan(ctx, "fees.manage");
  const v = entryInput.extend({ channel: z.enum(CHANNELS), reference: z.string().trim().min(2, "A transaction reference or receipt number is required").max(80) }).parse(raw);
  if (v.occurredOn > new Date().toISOString().slice(0, 10)) throw new UserError("Payment date cannot be in the future.");
  const dupe = await ctx.db
    .select({ id: ledgerEntry.id })
    .from(ledgerEntry)
    .where(and(eq(ledgerEntry.kind, "payment"), eq(ledgerEntry.channel, v.channel), eq(ledgerEntry.reference, v.reference), isNull(ledgerEntry.reversedAt)));
  if (dupe.length) throw new UserError("A payment with this channel and reference is already recorded.");
  const [e] = await ctx.db
    .insert(ledgerEntry)
    .values({ studentId: v.studentId, kind: "payment", description: v.description, amountCents: toCents(raw.amount), currency: v.currency, channel: v.channel, reference: v.reference, occurredOn: v.occurredOn, recordedBy: ctx.user.id })
    .returning({ id: ledgerEntry.id });
  await recordSchoolAudit(ctx.db, ctx, "fees.payment_recorded", { type: "ledger_entry", id: e!.id }, { proofId: opts.proofId ?? null, reference: v.reference });
  return e!.id;
}

/** Corrections are reversals with a reason; entries are never edited or deleted. */
export async function reverseEntry(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "fees.manage");
  const v = z.object({ entryId: z.string().uuid(), reason: z.string().trim().min(5, "Give a reason").max(300) }).parse(raw);
  const res = await ctx.db
    .update(ledgerEntry)
    .set({ reversedAt: new Date(), reversedBy: ctx.user.id, reversalReason: v.reason })
    .where(and(eq(ledgerEntry.id, v.entryId), isNull(ledgerEntry.reversedAt)))
    .returning({ id: ledgerEntry.id });
  if (!res.length) throw new UserError("Entry not found or already reversed.");
  await recordSchoolAudit(ctx.db, ctx, "fees.entry_reversed", { type: "ledger_entry", id: v.entryId }, { reason: v.reason });
}

/** Balances per currency (positive = owed to the school). USD and ZiG are never converted. */
export async function statement(ctx: SchoolContext, studentId: string) {
  await assertMaySeeFees(ctx, studentId);
  const entries = await ctx.db.select().from(ledgerEntry).where(eq(ledgerEntry.studentId, studentId)).orderBy(asc(ledgerEntry.occurredOn), asc(ledgerEntry.createdAt));
  const balances: Record<string, number> = {};
  for (const e of entries) {
    if (e.reversedAt) continue;
    balances[e.currency] = (balances[e.currency] ?? 0) + (e.kind === "charge" ? e.amountCents : -e.amountCents);
  }
  const proofs = await ctx.db.select().from(paymentProof).where(eq(paymentProof.studentId, studentId)).orderBy(desc(paymentProof.createdAt));
  return { entries, balances, proofs };
}

export async function outstanding(ctx: SchoolContext) {
  assertCan(ctx, "fees.view_all");
  return ctx.db
    .select({
      studentId: student.id,
      first: student.firstName,
      last: student.lastName,
      adm: student.admissionNumber,
      currency: ledgerEntry.currency,
      balance: sql<number>`sum(case when ${ledgerEntry.kind} = 'charge' then ${ledgerEntry.amountCents} else -${ledgerEntry.amountCents} end)::bigint`,
    })
    .from(ledgerEntry)
    .innerJoin(student, eq(student.id, ledgerEntry.studentId))
    .where(isNull(ledgerEntry.reversedAt))
    .groupBy(student.id, student.firstName, student.lastName, student.admissionNumber, ledgerEntry.currency)
    .having(sql`sum(case when ${ledgerEntry.kind} = 'charge' then ${ledgerEntry.amountCents} else -${ledgerEntry.amountCents} end) > 0`)
    .orderBy(asc(student.lastName))
    .then((rows) => rows.map((r) => ({ ...r, balance: Number(r.balance) })));
}

export async function feeTotals(ctx: SchoolContext) {
  assertCan(ctx, "fees.view_all");
  return ctx.db
    .select({
      currency: ledgerEntry.currency,
      charged: sql<number>`coalesce(sum(${ledgerEntry.amountCents}) filter (where ${ledgerEntry.kind} = 'charge'),0)::bigint`,
      paid: sql<number>`coalesce(sum(${ledgerEntry.amountCents}) filter (where ${ledgerEntry.kind} = 'payment'),0)::bigint`,
    })
    .from(ledgerEntry)
    .where(isNull(ledgerEntry.reversedAt))
    .groupBy(ledgerEntry.currency)
    .then((rows) => rows.map((r) => ({ currency: r.currency, charged: Number(r.charged), paid: Number(r.paid) })));
}

// ------------------------------------------------------------------ proof of payment
/** Parent uploads proof. It NEVER credits the account by itself. */
export async function submitProof(ctx: SchoolContext, raw: Record<string, unknown>, file: File | null) {
  const v = z
    .object({ studentId: z.string().uuid(), currency: z.enum(CURRENCIES), channel: z.enum(CHANNELS), reference: z.string().trim().min(2).max(80), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), comment: z.string().trim().max(500).optional() })
    .parse(raw);
  if (!(await isGuardianOf(ctx, v.studentId)) && !can(ctx, "fees.manage")) throw new ForbiddenError();
  const fileId = await storeUpload(ctx, file, "payment_proof", { required: true });
  const [p] = await ctx.db
    .insert(paymentProof)
    .values({ studentId: v.studentId, fileId: fileId!, amountCents: toCents(raw.amount), currency: v.currency, channel: v.channel, reference: v.reference, paidOn: v.paidOn, comment: v.comment || null, submittedBy: ctx.user.id })
    .returning({ id: paymentProof.id });
  await notify(ctx.db, await peopleWithRoles(ctx.db, ["accounts"]), { title: "New proof of payment to verify", source: "fees", link: `/s/${ctx.school.slug}/fees/proofs` });
  await recordSchoolAudit(ctx.db, ctx, "fees.proof_submitted", { type: "payment_proof", id: p!.id });
}

export async function listProofs(ctx: SchoolContext, status: "pending" | "verified" | "rejected" | "info_requested" = "pending") {
  assertCan(ctx, "fees.manage");
  return ctx.db
    .select({ p: paymentProof, first: student.firstName, last: student.lastName, adm: student.admissionNumber, fileName: fileObject.originalName })
    .from(paymentProof)
    .innerJoin(student, eq(student.id, paymentProof.studentId))
    .innerJoin(fileObject, eq(fileObject.id, paymentProof.fileId))
    .where(eq(paymentProof.status, status))
    .orderBy(asc(paymentProof.createdAt))
    .limit(200);
}

/** Verify (credits the ledger, amount may be corrected), reject, or ask for more information. */
export async function reviewProof(ctx: SchoolContext, raw: Record<string, unknown>) {
  assertCan(ctx, "fees.manage");
  const v = z.object({ proofId: z.string().uuid(), decision: z.enum(["verified", "rejected", "info_requested"]), note: z.string().trim().max(500).optional() }).parse(raw);
  const [p] = await ctx.db.select().from(paymentProof).where(eq(paymentProof.id, v.proofId));
  if (!p) throw new UserError("Proof not found.");
  if (p.status === "verified" || p.status === "rejected") throw new UserError("This proof has already been decided.");
  if (v.decision !== "verified" && !v.note) throw new UserError("Tell the parent why (note).");
  let entryId: string | null = null;
  if (v.decision === "verified") {
    entryId = await recordPayment(
      ctx,
      { studentId: p.studentId, currency: p.currency, description: `Payment (${p.channel}) verified from proof`, occurredOn: p.paidOn, channel: p.channel, reference: p.reference, amount: raw.amount ? raw.amount : (p.amountCents / 100).toFixed(2) },
      { proofId: p.id },
    );
  }
  await ctx.db.update(paymentProof).set({ status: v.decision, reviewedBy: ctx.user.id, reviewNote: v.note || null, ledgerEntryId: entryId }).where(eq(paymentProof.id, p.id));
  const [submitter] = await ctx.db.select({ id: studentGuardian.guardianPersonId }).from(studentGuardian).where(eq(studentGuardian.studentId, p.studentId));
  if (submitter) await notify(ctx.db, [submitter.id], { title: `Proof of payment ${v.decision.replace("_", " ")}`, body: v.note, source: "fees", link: `/s/${ctx.school.slug}/fees/student/${p.studentId}` });
  await recordSchoolAudit(ctx.db, ctx, `fees.proof_${v.decision}`, { type: "payment_proof", id: p.id }, { ledgerEntryId: entryId });
}

export async function studentsByIds(ctx: SchoolContext, ids: string[]) {
  return ids.length ? ctx.db.select().from(student).where(inArray(student.id, ids)) : [];
}
