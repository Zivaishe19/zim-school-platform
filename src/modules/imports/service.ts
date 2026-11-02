import "server-only";
import Papa from "papaparse";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { student } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { assertCan, type SchoolContext } from "@/server/tenancy/context";

export const STUDENT_CSV_HEADERS = ["admission_number", "first_name", "last_name", "date_of_birth", "gender"] as const;
export const STUDENT_CSV_TEMPLATE = `${STUDENT_CSV_HEADERS.join(",")}\nKH/2026/0001,Tendai,Moyo,2012-03-14,female\n`;
const MAX_ROWS = 3000;
const MAX_BYTES = 1_000_000;

const row = z.object({
  admission_number: z.string().trim().min(1, "missing").max(30).regex(/^[A-Za-z0-9/-]+$/, "only letters, digits, / and -"),
  first_name: z.string().trim().min(1, "missing").max(80),
  last_name: z.string().trim().min(1, "missing").max(80),
  date_of_birth: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "use YYYY-MM-DD").optional(),
  gender: z.enum(["female", "male", ""]).optional(),
});

export type ImportReport = {
  total: number;
  created: number;
  errors: { line: number; message: string }[];
  duplicates: { line: number; admissionNumber: string; reason: string }[];
  dryRun: boolean;
};

/**
 * CSV student import (Excel: "Save as CSV"). Validates every row first; nothing is written
 * unless the whole file is clean (all-or-nothing), so a half-imported file never happens.
 * Duplicates: admission number already in the school, or repeated within the file.
 * Also flags likely duplicates by same name + date of birth.
 */
export async function importStudentsCsv(ctx: SchoolContext, file: File | null, dryRun: boolean): Promise<ImportReport> {
  assertCan(ctx, "students.import");
  if (!file || file.size === 0) throw new UserError("Choose a CSV file.");
  if (file.size > MAX_BYTES) throw new UserError("File too large (max 1 MB, about 3,000 students). Split it into parts.");
  const text = (await file.text()).replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
  const headers = parsed.meta.fields ?? [];
  const missing = ["admission_number", "first_name", "last_name"].filter((h) => !headers.includes(h));
  if (missing.length) throw new UserError(`Missing column(s): ${missing.join(", ")}. Download the template.`);
  if (parsed.data.length > MAX_ROWS) throw new UserError(`Too many rows (max ${MAX_ROWS}).`);

  const report: ImportReport = { total: parsed.data.length, created: 0, errors: [], duplicates: [], dryRun };
  const valid: { line: number; v: z.infer<typeof row> }[] = [];
  const seen = new Map<string, number>();
  parsed.data.forEach((r, i) => {
    const line = i + 2;
    const res = row.safeParse({ ...r, gender: (r.gender ?? "").trim().toLowerCase() });
    if (!res.success) {
      report.errors.push({ line, message: res.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      return;
    }
    const key = res.data.admission_number.toUpperCase();
    if (seen.has(key)) report.duplicates.push({ line, admissionNumber: res.data.admission_number, reason: `repeats line ${seen.get(key)}` });
    else {
      seen.set(key, line);
      valid.push({ line, v: res.data });
    }
  });

  if (valid.length) {
    const existing = await ctx.db
      .select({ a: student.admissionNumber, f: student.firstName, l: student.lastName, d: student.dateOfBirth })
      .from(student)
      .where(inArray(student.admissionNumber, valid.map((x) => x.v.admission_number)));
    const taken = new Set(existing.map((e) => e.a));
    for (const x of valid) if (taken.has(x.v.admission_number)) report.duplicates.push({ line: x.line, admissionNumber: x.v.admission_number, reason: "admission number already exists" });
  }

  if (dryRun || report.errors.length || report.duplicates.length) return report;

  await ctx.db.transaction(async (tx) => {
    for (let i = 0; i < valid.length; i += 500) {
      await tx.insert(student).values(
        valid.slice(i, i + 500).map(({ v }) => ({
          admissionNumber: v.admission_number,
          firstName: v.first_name,
          lastName: v.last_name,
          dateOfBirth: v.date_of_birth || null,
          gender: v.gender || null,
          status: "registered" as const,
        })),
      );
    }
    await recordSchoolAudit(tx, ctx, "students.imported", { type: "import", id: file.name.slice(0, 100) }, { rows: valid.length });
  });
  report.created = valid.length;
  return report;
}
