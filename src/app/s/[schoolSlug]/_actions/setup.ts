"use server";
import { schoolAction, list } from "@/server/actions";
import * as setup from "@/modules/setup/service";
import { saveScale } from "@/modules/assessments/service";
import { applyProgression, closeYear, copyYearStructure, decideProgression, proposeProgression } from "@/modules/reports/service";

export async function saveProfile(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.saveProfile(c, v); return "School profile saved."; }); }
export async function createYear(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.createYear(c, v); return "Academic year created with its terms."; }); }
export async function openYear(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.openYear(c, String(v.yearId)); return "Year opened."; }); }
export async function updateTerm(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.updateTerm(c, v); return "Term saved."; }); }
export async function setForms(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.setForms(c, list(v.levels).map(Number)); return "Forms saved."; }); }
export async function createRoom(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.createRoom(c, v); return "Room added."; }); }
export async function createSubject(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.createSubject(c, v); return "Subject added."; }); }
export async function createClass(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.createClass(c, v); return "Class created."; }); }
export async function updateClass(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.updateClass(c, v); return "Class updated."; }); }
export async function enrol(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.enrolStudents(c, String(v.classId), list(v.studentIds)); return "Students placed in the class."; }); }
export async function createGroup(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.createGroup(c, v); return "Teaching group created."; }); }
export async function updateGroup(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.updateGroup(c, v); return "Teacher assigned."; }); }
export async function setGroupMembers(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.setGroupMembers(c, String(v.groupId), list(v.add), list(v.remove)); return "Group members updated."; }); }
export async function createPeriods(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await setup.createPeriods(c, { ...v, weekdays: list(v.weekdays) }); return "Periods saved."; }); }
export async function saveGradingScale(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await saveScale(c, v); return "Grading scale saved."; }); }
export async function propose(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => `${await proposeProgression(c, String(v.fromYearId), String(v.toYearId))} students proposed. Review each placement below.`); }
export async function decide(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await decideProgression(c, v); return "Decisions saved."; }); }
export async function apply(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => `${await applyProgression(c, String(v.fromYearId))} placements applied.`); }
export async function copyStructure(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => `${await copyYearStructure(c, String(v.fromYearId), String(v.toYearId))} classes copied (no student records).`); }
export async function close(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await closeYear(c, String(v.yearId)); return "Academic year closed. Its records are preserved and locked."; }); }
