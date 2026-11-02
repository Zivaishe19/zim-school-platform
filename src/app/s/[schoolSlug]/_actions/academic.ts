"use server";
import { schoolAction } from "@/server/actions";
import * as att from "@/modules/attendance/service";
import * as asmt from "@/modules/assessments/service";
import * as rep from "@/modules/reports/service";
import { list } from "@/server/actions";

export async function saveRegister(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { const r = await att.saveRegister(c, v); return `Register saved for ${r.saved} students.${r.notified ? ` ${r.notified} guardian notification(s) sent.` : ""}`; }); }
export async function explain(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await att.submitExplanation(c, v); return "Explanation sent to the school."; }); }
export async function reviewExplanation(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await att.reviewExplanation(c, v); return "Explanation reviewed."; }); }
export async function createAssessment(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { const a = await asmt.createAssessment(c, v); return { ok: "Assessment created.", to: `/s/${c.school.slug}/assessments/${a.id}` }; }); }
export async function saveMarks(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await asmt.saveMarks(c, v); return "Marks saved."; }); }
export async function approveMarks(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => `${await asmt.advanceMarks(c, String(v.assessmentId), "approved")} mark(s) approved.`); }
export async function publishMarks(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => `${await asmt.advanceMarks(c, String(v.assessmentId), "published")} mark(s) published to students and parents.`); }
export async function submitWork(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await asmt.submitWork(c, String(v.assessmentId), String(v.text ?? ""), fd.get("file") as File | null); return "Work submitted."; }); }
export async function addMaterial(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await asmt.addMaterial(c, { groupId: String(v.groupId), title: String(v.title ?? ""), description: String(v.description ?? ""), link: String(v.link ?? "") }, fd.get("file") as File | null); return "Material shared with the group."; }); }
export async function teacherComment(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await rep.saveTeacherComment(c, v); return v.submit ? "Report submitted for approval." : "Draft saved."; }); }
export async function approveReport(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await rep.approveReport(c, v); return "Report approved and frozen."; }); }
export async function publishReports(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => `${await rep.publishReports(c, list(v.reportIds))} report(s) published.`); }
export async function reopenReport(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await rep.reopenReport(c, v); return "Report reopened. The change is recorded in the audit log."; }); }
