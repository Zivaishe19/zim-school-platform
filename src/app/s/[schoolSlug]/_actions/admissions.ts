"use server";
import { schoolAction } from "@/server/actions";
import * as adm from "@/modules/admissions/service";

export async function walkIn(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { const r = await adm.createWalkIn(c, v); return { ok: `Application ${r.reference} recorded.`, to: `/s/${c.school.slug}/admissions/${r.id}` }; }); }
export async function decide(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { const r = await adm.decideApplication(c, v); return r.studentId ? "Accepted: a registered student record was created. Place them in a class from Setup > Classes." : "Status updated."; }); }
export async function addDocument(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await adm.addApplicationDocument(c, String(v.applicationId), String(v.kind), fd.get("file") as File | null, v.physical === "on"); return "Document added."; }); }
