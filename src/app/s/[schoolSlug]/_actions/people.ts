"use server";
import { schoolAction, list } from "@/server/actions";
import * as people from "@/modules/people/service";
import { createStudent, updateStudent } from "@/modules/students/service";
import { importStudentsCsv } from "@/modules/imports/service";
import { UserError } from "@/server/errors";

export async function addPerson(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await people.addPerson(c, { ...v, roles: list(v.roles) }); return "Person added. Share the temporary password with them privately; they must change it at first sign-in."; }); }
export async function setRoles(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await people.setRoles(c, String(v.personId), list(v.roles)); return "Roles saved."; }); }
export async function resetPassword(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await people.resetPassword(c, v); return "Password reset. Their sessions were signed out and they must choose a new password."; }); }
export async function revoke(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await people.revokeAccess(c, String(v.personId)); return "Access to this school removed."; }); }
export async function linkGuardian(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await people.linkGuardian(c, v); return "Guardian linked."; }); }
export async function unlinkGuardian(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await people.unlinkGuardian(c, String(v.studentId), String(v.guardianPersonId)); return "Guardian unlinked."; }); }
export async function createStudentLogin(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await people.createStudentLogin(c, v); return "Student login created."; }); }
export async function updateStudentAction(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await updateStudent(c, v); return "Student updated."; }); }
export async function quickCreateStudent(slug: string, fd: FormData) {
  return schoolAction(slug, fd, async (c, v) => {
    const r = await createStudent(c, { admissionNumber: String(v.admissionNumber ?? ""), firstName: String(v.firstName ?? ""), lastName: String(v.lastName ?? ""), dateOfBirth: String(v.dateOfBirth ?? "") });
    if (!r.ok) throw new UserError(Object.entries(r.fieldErrors).map(([k, m]) => `${k}: ${m.join(", ")}`).join("; "));
    return { ok: "Student created.", to: `/s/${c.school.slug}/students/${r.id}` };
  });
}
export async function importStudents(slug: string, fd: FormData) {
  return schoolAction(slug, fd, async (c) => {
    const dry = fd.get("mode") !== "import";
    const r = await importStudentsCsv(c, fd.get("file") as File | null, dry);
    const problems = [...r.errors.map((e) => `line ${e.line}: ${e.message}`), ...r.duplicates.map((d) => `line ${d.line}: ${d.admissionNumber} ${d.reason}`)];
    if (problems.length) throw new UserError(`${problems.length} problem(s), nothing imported. ${problems.slice(0, 8).join(" | ")}${problems.length > 8 ? " | …" : ""}`);
    return dry ? `Check passed: ${r.total} rows are valid. Choose "Import" to save them.` : `${r.created} students imported.`;
  });
}
