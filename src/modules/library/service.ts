import "server-only";
import Papa from "papaparse";
import { and, asc, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { book, loan, person, student } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { assertCan, type SchoolContext } from "@/server/tenancy/context";
import { requireVisibleStudent } from "@/server/tenancy/scope";
import { getProfile } from "@/modules/setup/service";

export async function listBooks(ctx: SchoolContext, q?: string, status?: string) {
  const st = (["available", "on_loan", "lost", "damaged", "withdrawn"] as const).find((s) => s === status);
  return ctx.db
    .select()
    .from(book)
    .where(and(q ? or(ilike(book.title, `%${q}%`), ilike(book.author, `%${q}%`), ilike(book.accessionNumber, `%${q}%`)) : undefined, st ? eq(book.status, st) : undefined))
    .orderBy(asc(book.title))
    .limit(200);
}

const bookInput = z.object({
  accessionNumber: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().max(160).optional(),
  isbn: z.string().trim().max(20).optional(),
  category: z.string().trim().max(60).optional(),
});

export async function addBook(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "library.manage");
  const v = bookInput.parse(raw);
  const dupe = await ctx.db.select({ id: book.id }).from(book).where(eq(book.accessionNumber, v.accessionNumber));
  if (dupe.length) throw new UserError("That accession number is already used.");
  await ctx.db.insert(book).values({ ...v, author: v.author || null, isbn: v.isbn || null, category: v.category || null });
}

/** CSV columns: accession_number,title,author,isbn,category. All-or-nothing. */
export async function importBooks(ctx: SchoolContext, file: File | null) {
  assertCan(ctx, "library.manage");
  if (!file || file.size === 0 || file.size > 1_000_000) throw new UserError("Choose a CSV file under 1 MB.");
  const parsed = Papa.parse<Record<string, string>>((await file.text()).replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });
  const rows = parsed.data.map((r, i) => ({ line: i + 2, r: bookInput.safeParse({ accessionNumber: r.accession_number, title: r.title, author: r.author, isbn: r.isbn, category: r.category }) }));
  const bad = rows.filter((x) => !x.r.success).map((x) => x.line);
  if (bad.length) throw new UserError(`Rows with problems: ${bad.slice(0, 20).join(", ")}. Nothing was imported.`);
  await ctx.db.transaction(async (tx) => {
    for (const x of rows) if (x.r.success) await tx.insert(book).values(x.r.data).onConflictDoNothing();
  });
  return rows.length;
}

export async function exportBooksCsv(ctx: SchoolContext) {
  assertCan(ctx, "library.manage");
  const rows = await ctx.db.select().from(book).orderBy(asc(book.accessionNumber));
  return Papa.unparse(rows.map((b) => ({ accession_number: b.accessionNumber, title: b.title, author: b.author ?? "", isbn: b.isbn ?? "", category: b.category ?? "", status: b.status })));
}

/** Lend to a student (by admission number) or a staff member. Enforces school loan limits. */
export async function lend(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "library.manage");
  const v = z.object({ accessionNumber: z.string().trim().min(1), admissionNumber: z.string().trim().optional(), staffPersonId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)) }).parse(raw);
  const profile = await getProfile(ctx);
  return ctx.db.transaction(async (tx) => {
    const [b] = await tx.select().from(book).where(eq(book.accessionNumber, v.accessionNumber)).for("update");
    if (!b) throw new UserError("No book with that accession number.");
    if (b.status !== "available") throw new UserError(`This copy is ${b.status.replace("_", " ")}.`);
    let studentId: string | null = null;
    let personId: string | null = null;
    if (v.admissionNumber) {
      const [s] = await tx.select({ id: student.id }).from(student).where(eq(student.admissionNumber, v.admissionNumber));
      if (!s) throw new UserError("No student with that admission number.");
      studentId = s.id;
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(loan).where(and(eq(loan.borrowerStudentId, s.id), isNull(loan.returnedOn)));
      if (n >= profile.studentLoanLimit) throw new UserError(`Students may have ${profile.studentLoanLimit} book(s) at a time. Return the current loan first.`);
    } else if (v.staffPersonId) {
      personId = v.staffPersonId;
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(loan).where(and(eq(loan.borrowerPersonId, personId), isNull(loan.returnedOn)));
      if (n >= profile.staffLoanLimit) throw new UserError(`Staff may have ${profile.staffLoanLimit} books at a time.`);
    } else throw new UserError("Give a student admission number or choose a staff member.");
    const borrowed = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + profile.loanDays * 86_400_000).toISOString().slice(0, 10);
    await tx.insert(loan).values({ bookId: b.id, borrowerStudentId: studentId, borrowerPersonId: personId, borrowedOn: borrowed, dueOn: due, recordedBy: ctx.user.id });
    await tx.update(book).set({ status: "on_loan" }).where(eq(book.id, b.id));
    await recordSchoolAudit(tx, ctx, "library.lent", { type: "book", id: b.id }, { studentId, personId });
    return due;
  });
}

export async function returnLoan(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "library.manage");
  const v = z.object({ loanId: z.string().uuid(), outcome: z.enum(["returned", "lost", "damaged"]), note: z.string().trim().max(300).optional() }).parse(raw);
  await ctx.db.transaction(async (tx) => {
    const [l] = await tx.select().from(loan).where(and(eq(loan.id, v.loanId), isNull(loan.returnedOn)));
    if (!l) throw new UserError("Loan not found or already closed.");
    await tx.update(loan).set({ returnedOn: new Date().toISOString().slice(0, 10), outcome: v.outcome, note: v.note || null }).where(eq(loan.id, l.id));
    await tx.update(book).set({ status: v.outcome === "returned" ? "available" : v.outcome }).where(eq(book.id, l.bookId));
    await recordSchoolAudit(tx, ctx, `library.${v.outcome}`, { type: "book", id: l.bookId });
  });
}

export async function openLoans(ctx: SchoolContext, overdueOnly = false) {
  assertCan(ctx, "library.manage");
  const today = new Date().toISOString().slice(0, 10);
  return ctx.db
    .select({ l: loan, title: book.title, acc: book.accessionNumber, sFirst: student.firstName, sLast: student.lastName, adm: student.admissionNumber, pFirst: person.firstName, pLast: person.lastName })
    .from(loan)
    .innerJoin(book, eq(book.id, loan.bookId))
    .leftJoin(student, eq(student.id, loan.borrowerStudentId))
    .leftJoin(person, eq(person.id, loan.borrowerPersonId))
    .where(and(isNull(loan.returnedOn), overdueOnly ? lt(loan.dueOn, today) : undefined))
    .orderBy(asc(loan.dueOn));
}

export async function studentLoans(ctx: SchoolContext, studentId: string) {
  await requireVisibleStudent(ctx, studentId);
  return ctx.db
    .select({ title: book.title, borrowedOn: loan.borrowedOn, dueOn: loan.dueOn, returnedOn: loan.returnedOn, outcome: loan.outcome })
    .from(loan)
    .innerJoin(book, eq(book.id, loan.bookId))
    .where(eq(loan.borrowerStudentId, studentId))
    .orderBy(desc(loan.borrowedOn));
}
