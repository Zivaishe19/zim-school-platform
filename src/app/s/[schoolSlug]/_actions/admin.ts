"use server";
import { schoolAction } from "@/server/actions";
import * as fees from "@/modules/fees/service";
import * as lib from "@/modules/library/service";
import * as disc from "@/modules/discipline/service";
import * as staff from "@/modules/staff/service";
import * as tt from "@/modules/timetable/service";
import { list } from "@/server/actions";

export async function createFeeItem(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await fees.createFeeItem(c, v); return "Fee item created."; }); }
export async function applyFeeItem(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { const r = await fees.applyFeeItem(c, String(v.feeItemId)); return `Charged ${r.charged} student(s); ${r.skipped} already charged.`; }); }
export async function addCharge(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await fees.addCharge(c, v); return "Charge added."; }); }
export async function recordPayment(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await fees.recordPayment(c, v); return "Payment recorded."; }); }
export async function reverse(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await fees.reverseEntry(c, v); return "Entry reversed."; }); }
export async function submitProof(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await fees.submitProof(c, v, fd.get("file") as File | null); return "Proof of payment sent. The accounts office will verify it; your balance changes only after verification."; }); }
export async function reviewProof(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await fees.reviewProof(c, v); return "Proof reviewed."; }); }
export async function addBook(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await lib.addBook(c, v); return "Book added."; }); }
export async function importBooks(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c) => `${await lib.importBooks(c, fd.get("file") as File | null)} rows processed.`); }
export async function lend(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => `Lent. Due back ${await lib.lend(c, v)}.`); }
export async function returnLoan(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await lib.returnLoan(c, v); return "Loan closed."; }); }
export async function reportIncident(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await disc.reportIncident(c, v); return "Incident reported for review."; }); }
export async function decideIncident(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await disc.decideIncident(c, v); return "Decision recorded."; }); }
export async function assignDuty(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await disc.assignDuty(c, v); return "Duty assigned."; }); }
export async function rotateDuty(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => `Rotation created for ${await disc.rotateDuty(c, v)} students.`); }
export async function endDuty(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await disc.endDuty(c, String(v.dutyId)); return "Duty ended (kept in history)."; }); }
export async function saveStaffRegister(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await staff.saveStaffRegister(c, v); return "Staff register saved."; }); }
export async function requestLeave(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await staff.requestLeave(c, v); return "Leave request sent."; }); }
export async function reviewLeave(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await staff.reviewLeave(c, v); return "Leave request decided."; }); }
export async function addEntry(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { const w = await tt.addEntry(c, { ...v, periodIds: list(v.periodIds) }); return w.length ? `Added, with warnings: ${w.join(" ")}` : "Added to the timetable."; }); }
export async function removeEntry(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await tt.removeEntry(c, String(v.entryId)); return "Removed."; }); }
export async function addOverride(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await tt.addOverride(c, v); return "Change saved for that date. Affected people were notified."; }); }
export async function removeOverride(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await tt.removeOverride(c, String(v.overrideId)); return "Change removed."; }); }
export async function importTimetable(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c) => { const r = await tt.importTimetable(c, fd.get("file") as File | null); return `${r.added} entries added.${r.errors.length ? ` Skipped: ${r.errors.slice(0, 6).join(" | ")}` : ""}`; }); }
