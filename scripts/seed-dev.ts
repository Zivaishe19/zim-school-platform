/**
 * Development seed: two independently provisioned FICTIONAL schools with fake people,
 * built through the real services (so the seed also exercises permissions and audit).
 * Never run against production. Every account uses one dev password (printed below).
 *
 *   npm run db:reset && npm run db:setup && npm run db:seed
 */
import "./lib/load-env";
import { eq } from "drizzle-orm";
import { createAccount } from "@/server/auth/accounts";
import { closePlatformDb, platformDb } from "@/server/db/platform/client";
import { platformAdmin } from "@/server/db/platform/schema";
import { attendanceMark, attendanceSession, student, studentGuardian } from "@/server/db/school/schema";
import { closeAllSchoolDbs, getSchoolDb } from "@/server/tenancy/client-cache";
import { resolveSchoolContext, type SchoolContext } from "@/server/tenancy/context";
import { addSchoolMember } from "@/server/tenancy/membership";
import { provisionSchool } from "@/server/tenancy/provisioning";
import type { RoleKey } from "@/server/rbac/roles";
import * as setup from "@/modules/setup/service";
import * as asmt from "@/modules/assessments/service";
import * as att from "@/modules/attendance/service";
import * as comms from "@/modules/comms/service";
import * as fees from "@/modules/fees/service";
import * as lib from "@/modules/library/service";
import * as disc from "@/modules/discipline/service";
import * as rep from "@/modules/reports/service";
import * as tt from "@/modules/timetable/service";
import * as adm from "@/modules/admissions/service";

export const DEV_PASSWORD = "Demo-Password-2026!";

const FIRST = ["Tendai", "Rutendo", "Farai", "Tatenda", "Nyasha", "Chipo", "Tafadzwa", "Kudzai", "Rumbidzai", "Tinashe", "Sibusiso", "Thandeka", "Nkosana", "Busisiwe", "Mthokozisi", "Nomvula", "Takudzwa", "Ruvimbo", "Simbarashe", "Vimbai"];
const LAST = ["Moyo", "Ncube", "Sibanda", "Dube", "Ndlovu", "Mpofu", "Chikwanha", "Mutasa", "Marufu", "Chirwa", "Zvobgo", "Mhlanga", "Gumbo", "Nyathi", "Mapfumo", "Banda", "Chigumba", "Mukarati"];

function fakeStudents(prefix: string, n: number, seed: number) {
  return Array.from({ length: n }, (_, i) => ({
    admissionNumber: `${prefix}/${2021 + (i % 5)}/${String(i + 1).padStart(4, "0")}`,
    firstName: FIRST[(i * 7 + seed) % FIRST.length]!,
    lastName: LAST[(i * 5 + seed * 3) % LAST.length]!,
    dateOfBirth: `${2008 + (i % 6)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
    gender: i % 2 ? "male" : "female",
    status: "enrolled" as const,
  }));
}

async function person(schoolId: string, name: string, login: { email?: string; username?: string }, roles: RoleKey[]) {
  const [first, ...rest] = name.split(" ");
  const { userId } = await createAccount({ name, ...login, password: DEV_PASSWORD });
  const { personId } = await addSchoolMember({ schoolId, userId, firstName: first!, lastName: rest.join(" "), roles });
  return { userId, personId, name };
}

async function ctxOf(userId: string, name: string, slug: string): Promise<SchoolContext> {
  const c = await resolveSchoolContext({ id: userId, name }, slug);
  if (!c) throw new Error(`no context for ${name}`);
  return c;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Last N weekdays (most recent last), not including today. */
function lastWeekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(iso(d));
  }
  return out;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed production");
  const year = new Date().getUTCFullYear();

  // ---------------------------------------------------------------- school A: Kopje Heights (ZIMSEC + some Cambridge)
  const kopje = await provisionSchool({ slug: "kopje-heights", name: "Kopje Heights High School (demo)" });
  const umguza = await provisionSchool({ slug: "umguza-valley", name: "Umguza Valley College (demo)" });
  const dbA = await getSchoolDb(kopje.schoolId);
  const kopjeStudents = await dbA.insert(student).values(fakeStudents("KH", 60, 1)).returning({ id: student.id });

  const admin = await person(kopje.schoolId, "Grace Mutasa", { email: "admin@kopje.example.test" }, ["school_admin"]);
  const head = await person(kopje.schoolId, "Obert Chirwa", { email: "head@kopje.example.test" }, ["headmaster"]);
  const teacher = await person(kopje.schoolId, "Nomvula Sibanda", { email: "teacher@kopje.example.test" }, ["teacher", "class_teacher"]);
  const teacher2 = await person(kopje.schoolId, "Blessing Marufu", { email: "teacher2@kopje.example.test" }, ["teacher"]);
  const accounts = await person(kopje.schoolId, "Precious Gumbo", { email: "accounts@kopje.example.test" }, ["accounts"]);
  const librarian = await person(kopje.schoolId, "Lovemore Nyathi", { email: "library@kopje.example.test" }, ["librarian"]);
  const parent = await person(kopje.schoolId, "Tendai Moyo", { email: "parent@kopje.example.test" }, ["parent"]);
  const learner = await person(kopje.schoolId, "Rumbidzai Chikwanha", { username: "rumbi.chikwanha" }, ["student"]);

  const A = await ctxOf(admin.userId, admin.name, "kopje-heights");
  await setup.saveProfile(A, { displayName: "Kopje Heights High School", motto: "Knowledge is light", address: "12 Kopje Road, Harare", phone: "+263 242 000000", email: "office@kopje.example.test", defaultCurrency: "USD", studentLoanLimit: "1", staffLoanLimit: "5", loanDays: "14" });
  const y = await setup.createYear(A, { name: String(year), startsOn: `${year}-01-13`, endsOn: `${year}-12-04`, terms: "3" });
  await setup.openYear(A, y.id);
  const terms = await setup.listTerms(A, y.id);
  const nowIso = iso(new Date());
  const currentT = terms.find((t) => t.startsOn <= nowIso && t.endsOn >= nowIso) ?? terms.at(-1)!;
  await setup.updateTerm(A, { termId: currentT.id, name: currentT.name, startsOn: currentT.startsOn, endsOn: currentT.endsOn, open: "on" });
  await setup.setForms(A, [1, 2, 3, 4, 5, 6]);
  const forms = await setup.listForms(A);
  const formId = (l: number) => forms.find((f) => f.level === l)!.id;
  for (const r of [["Room 1", 45], ["Room 2", 45], ["Room 3", 40], ["Science Lab", 30], ["Computer Lab", 30], ["Hall", 600]] as const) await setup.createRoom(A, { name: r[0], capacity: String(r[1]), kind: r[0].includes("Lab") ? "laboratory" : r[0] === "Hall" ? "hall" : "classroom" });
  const rooms = await setup.listRooms(A);
  const roomId = (n: string) => rooms.find((r) => r.name === n)!.id;
  for (const [code, name, board, prac] of [
    ["4004", "Mathematics", "zimsec", false], ["1122", "English Language", "zimsec", false], ["3159", "Shona", "zimsec", false],
    ["4003", "Combined Science", "zimsec", true], ["2248", "Geography", "zimsec", false], ["2167", "History", "zimsec", false],
    ["7112", "Principles of Accounts", "zimsec", false], ["4021", "Computer Science", "zimsec", true], ["0625", "Physics", "cambridge", true],
  ] as const) await setup.createSubject(A, { code, name, examBoard: board, isPractical: prac ? "on" : "" });
  const subjects = await setup.listSubjects(A);
  const subj = (n: string) => subjects.find((s) => s.name === n)!.id;

  const c1 = await setup.createClass(A, { academicYearId: y.id, formId: formId(1), name: "1 Blue", roomId: roomId("Room 1"), classTeacherPersonId: teacher.personId });
  const c2 = await setup.createClass(A, { academicYearId: y.id, formId: formId(2), name: "2 Green", roomId: roomId("Room 2"), classTeacherPersonId: teacher2.personId });
  const c4 = await setup.createClass(A, { academicYearId: y.id, formId: formId(4), name: "4 Gold", roomId: roomId("Room 3") });
  const ids = kopjeStudents.map((s) => s.id);
  await setup.enrolStudents(A, c1.id, ids.slice(0, 25));
  await setup.enrolStudents(A, c2.id, ids.slice(25, 45));
  await setup.enrolStudents(A, c4.id, ids.slice(45, 60));

  const g1m = await setup.createGroup(A, { academicYearId: y.id, subjectId: subj("Mathematics"), name: "1 Blue Mathematics", formId: formId(1), classId: c1.id, teacherPersonId: teacher.personId, addClassMembers: "on" });
  const g1e = await setup.createGroup(A, { academicYearId: y.id, subjectId: subj("English Language"), name: "1 Blue English", formId: formId(1), classId: c1.id, teacherPersonId: teacher2.personId, addClassMembers: "on" });
  const g1s = await setup.createGroup(A, { academicYearId: y.id, subjectId: subj("Combined Science"), name: "1 Blue Combined Science", formId: formId(1), classId: c1.id, teacherPersonId: teacher2.personId, addClassMembers: "on" });
  const g2m = await setup.createGroup(A, { academicYearId: y.id, subjectId: subj("Mathematics"), name: "2 Green Mathematics", formId: formId(2), classId: c2.id, teacherPersonId: teacher.personId, addClassMembers: "on" });
  const g4p = await setup.createGroup(A, { academicYearId: y.id, subjectId: subj("Physics"), name: "Form 4 Physics (Cambridge)", formId: formId(4), teacherPersonId: teacher2.personId });
  await setup.setGroupMembers(A, g4p.id, ids.slice(45, 55), []);

  // Bell schedule Mon-Fri
  const bells: [number, string, string, string, "lesson" | "break" | "assembly"][] = [[0, "Assembly", "07:30", "07:50", "assembly"], [1, "Period 1", "07:50", "08:30", "lesson"], [2, "Period 2", "08:30", "09:10", "lesson"], [3, "Period 3", "09:10", "09:50", "lesson"], [4, "Break", "09:50", "10:20", "break"], [5, "Period 4", "10:20", "11:00", "lesson"], [6, "Period 5", "11:00", "11:40", "lesson"]];
  for (const [n, label, s, e, kind] of bells) await setup.createPeriods(A, { weekdays: ["1", "2", "3", "4", "5"], number: String(n), label, startsAt: s, endsAt: e, kind });
  const periods = await setup.listPeriods(A);
  const pid = (wd: number, n: number) => periods.find((p) => p.weekday === wd && p.number === n)!.id;
  await tt.addEntry(A, { periodIds: [pid(1, 1), pid(3, 1), pid(5, 2)], kind: "lesson", teachingGroupId: g1m.id, roomId: roomId("Room 1") });
  await tt.addEntry(A, { periodIds: [pid(1, 2), pid(2, 1), pid(4, 3)], kind: "lesson", teachingGroupId: g1e.id, roomId: roomId("Room 1") });
  await tt.addEntry(A, { periodIds: [pid(2, 3), pid(4, 5)], kind: "lesson", teachingGroupId: g1s.id, roomId: roomId("Science Lab") });
  await tt.addEntry(A, { periodIds: [pid(1, 3), pid(3, 2)], kind: "lesson", teachingGroupId: g2m.id, roomId: roomId("Room 2") });
  await tt.addEntry(A, { periodIds: [pid(2, 5), pid(5, 5)], kind: "lesson", teachingGroupId: g4p.id, roomId: roomId("Science Lab") });
  await tt.addEntry(A, { periodIds: [pid(5, 6)], kind: "sport", label: "Inter-house athletics practice", roomId: undefined });

  // Guardians and the student's own login
  await dbA.insert(studentGuardian).values([
    { studentId: ids[0]!, guardianPersonId: parent.personId, relationship: "mother" },
    { studentId: ids[1]!, guardianPersonId: parent.personId, relationship: "mother" },
  ]);
  await dbA.update(student).set({ personId: learner.personId }).where(eq(student.id, ids[2]!));

  // Attendance: daily (class teacher) and lessons, last 5 weekdays
  const T = await ctxOf(teacher.userId, teacher.name, "kopje-heights");
  const members1 = await setup.classMembers(T, c1.id);
  for (const [di, date] of lastWeekdays(5).entries()) {
    const v: Record<string, string> = { kind: "daily", targetId: c1.id, date };
    members1.forEach((m, i) => (v[`status_${m.id}`] = (i + di) % 11 === 0 ? "absent" : (i + di) % 7 === 0 ? "late" : "present"));
    await att.saveRegister(T, v);
    const l: Record<string, string> = { kind: "lesson", targetId: g1m.id, date, period: "Period 1" };
    members1.forEach((m, i) => (l[`status_${m.id}`] = (i + di) % 13 === 0 ? "absent" : "present"));
    await att.saveRegister(T, l);
  }

  // Assessments and marks (Mathematics, 1 Blue)
  const a1 = await asmt.createAssessment(T, { groupId: g1m.id, termId: currentT.id, title: "Fractions test", kind: "test", maxScore: "50", weight: "30", dueOn: lastWeekdays(10)[0] });
  const a2 = await asmt.createAssessment(T, { groupId: g1m.id, termId: currentT.id, title: "Algebra homework", kind: "assignment", maxScore: "20", weight: "", acceptsSubmissions: "on", dueOn: iso(new Date(Date.now() + 5 * 86_400_000)), instructions: "Exercise 4.2, questions 1-10. Show your working." });
  const a3 = await asmt.createAssessment(T, { groupId: g1m.id, termId: currentT.id, title: "Mid-term exam", kind: "exam", maxScore: "100", weight: "40" });
  const marks1: Record<string, string> = { assessmentId: a1.id };
  members1.forEach((m, i) => { if (i === 3) marks1[`missing_${m.id}`] = "on"; else marks1[`score_${m.id}`] = String(20 + ((i * 7) % 30)); });
  await asmt.saveMarks(T, marks1);
  const marks3: Record<string, string> = { assessmentId: a3.id };
  members1.forEach((m, i) => { if (i % 5 !== 0) marks3[`score_${m.id}`] = String(45 + ((i * 11) % 50)); });
  await asmt.saveMarks(T, marks3);
  const H = await ctxOf(head.userId, head.name, "kopje-heights");
  await asmt.advanceMarks(H, a1.id, "approved");
  await asmt.advanceMarks(H, a1.id, "published");
  void a2;

  // Report cards: two submitted by the class teacher, one approved+published by the head
  for (const sid of ids.slice(0, 3)) await rep.saveTeacherComment(T, { studentId: sid, termId: currentT.id, classId: c1.id, comment: "A pleasant and hard-working learner. Keep it up.", submit: "1" });
  const queue = await rep.submittedReports(H);
  await rep.approveReport(H, { reportId: queue[0]!.id, headComment: "Good progress this term." });
  await rep.publishReports(H, [queue[0]!.id]);

  // Fees
  const ACC = await ctxOf(accounts.userId, accounts.name, "kopje-heights");
  await fees.createFeeItem(ACC, { name: `Term ${currentT.number} tuition`, amount: "320.00", currency: "USD", termId: currentT.id, formLevel: "" });
  await fees.createFeeItem(ACC, { name: "Sports levy", amount: "450.00", currency: "ZiG", termId: currentT.id, formLevel: "" });
  for (const f of await fees.listFeeItems(ACC)) await fees.applyFeeItem(ACC, f.f.id);
  await fees.recordPayment(ACC, { studentId: ids[0]!, currency: "USD", description: "Payment", occurredOn: lastWeekdays(3)[0], channel: "ecocash", reference: "MP240611.1543.A12345", amount: "200.00" });
  await fees.recordPayment(ACC, { studentId: ids[5]!, currency: "USD", description: "Payment", occurredOn: lastWeekdays(2)[0], channel: "bank", reference: "CBZ-889201", amount: "320.00" });
  const P = await ctxOf(parent.userId, parent.name, "kopje-heights");
  const pdf = new File([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")], "ecocash-receipt.pdf", { type: "application/pdf" });
  await fees.submitProof(P, { studentId: ids[1]!, currency: "USD", channel: "ecocash", reference: "MP240612.0930.B77881", paidOn: lastWeekdays(1)[0], amount: "120.00", comment: "Part payment for Rutendo" }, pdf);

  // Library
  const L = await ctxOf(librarian.userId, librarian.name, "kopje-heights");
  for (const [acc, title, author, cat] of [["KH-0001", "Things Fall Apart", "Chinua Achebe", "Literature"], ["KH-0002", "Nervous Conditions", "Tsitsi Dangarembga", "Literature"], ["KH-0003", "New General Mathematics 1", "Channon et al.", "Mathematics"], ["KH-0004", "Zimbabwe: A History", "—", "History"], ["KH-0005", "Integrated Science Book 1", "—", "Science"]]) await lib.addBook(L, { accessionNumber: acc, title, author, category: cat });
  const kh = await dbA.select().from(student).where(eq(student.id, ids[0]!));
  await lib.lend(L, { accessionNumber: "KH-0001", admissionNumber: kh[0]!.admissionNumber });
  await lib.lend(L, { accessionNumber: "KH-0003", staffPersonId: teacher.personId });

  // Discipline, events, announcements, clubs, admissions
  await disc.reportIncident(T, { studentId: ids[4]!, category: "homework", description: "Did not hand in homework three times this week.", occurredOn: lastWeekdays(1)[0], recommendedAction: "Warning" });
  await disc.reportIncident(T, { studentId: ids[1]!, category: "late_coming", description: "Late for school twice.", occurredOn: lastWeekdays(2)[0], recommendedAction: "Detention" });
  const inc = await disc.listIncidents(H, "reported");
  const late = inc.find((i) => i.i.studentId === ids[1]);
  if (late) await disc.decideIncident(H, { id: late.i.id, decision: "approved", approvedAction: "One detention, Friday 14:00", visibleToParent: "on" });
  await comms.createEvent(H, { title: "Prize-giving day", kind: "other", startsAt: `${iso(new Date(Date.now() + 9 * 86_400_000))}T10:00`, endsAt: "", location: "School hall", description: "Parents welcome.", audienceKind: "everyone" });
  await comms.createEvent(H, { title: "Form 1 parents' meeting", kind: "parent_meeting", startsAt: `${iso(new Date(Date.now() + 4 * 86_400_000))}T14:30`, endsAt: "", location: "Room 1", audienceKind: "form", audienceIds: [formId(1)] });
  await comms.sendAnnouncement(H, { title: "Welcome to the new school system", body: "Parents can now see attendance, progress, reports and fees for their children, and upload proof of payment.", audienceKind: "everyone" });
  await comms.createActivity(A, { name: "Chess Club", kind: "club", schedule: "Wednesdays 14:30", patronPersonId: teacher2.personId });
  await comms.createActivity(A, { name: "Soccer (U15)", kind: "sport", schedule: "Tue & Thu 15:00", patronPersonId: teacher.personId });
  const acts = await comms.listActivities(A);
  await comms.addActivityMember(A, { activityId: acts[0]!.a.id, admissionNumber: kh[0]!.admissionNumber, role: "Secretary" });
  await adm.createWalkIn(A, { entryType: "form1", firstName: "Tanaka", lastName: "Mhlanga", dateOfBirth: `${year - 12}-05-02`, gender: "male", previousSchool: "Kopje Primary", guardianName: "Joyce Mhlanga", guardianPhone: "+263 77 000 0001", guardianEmail: "" });
  await comms.startThread(P, { studentId: ids[0]!, category: "academic_concern", subject: "Mathematics homework", body: "Good afternoon. Tendai is finding fractions difficult. Is there extra help available?", staffPersonId: teacher.personId });

  // ---------------------------------------------------------------- school B: Umguza Valley (Cambridge-leaning)
  const dbB = await getSchoolDb(umguza.schoolId);
  const umStudents = await dbB.insert(student).values(fakeStudents("UV", 40, 4)).returning({ id: student.id });
  const adminB = await person(umguza.schoolId, "Sipho Ndlovu", { email: "admin@umguza.example.test" }, ["school_admin"]);
  const B = await ctxOf(adminB.userId, adminB.name, "umguza-valley");
  const yb = await setup.createYear(B, { name: String(year), startsOn: `${year}-01-13`, endsOn: `${year}-12-04`, terms: "3" });
  await setup.openYear(B, yb.id);
  await setup.setForms(B, [1, 2, 3, 4, 5, 6]);
  const fb = await setup.listForms(B);
  const cb = await setup.createClass(B, { academicYearId: yb.id, formId: fb.find((f) => f.level === 3)!.id, name: "3 Mopane" });
  await setup.enrolStudents(B, cb.id, umStudents.map((s) => s.id));
  await setup.createSubject(B, { code: "0580", name: "Mathematics", examBoard: "cambridge", isPractical: "" });

  // Accounts at both schools + platform operator
  const { userId: multi } = await createAccount({ name: "Farai Zvobgo", email: "support@multi.example.test", password: DEV_PASSWORD });
  await addSchoolMember({ schoolId: kopje.schoolId, userId: multi, firstName: "Farai", lastName: "Zvobgo", roles: ["system_admin"] });
  await addSchoolMember({ schoolId: umguza.schoolId, userId: multi, firstName: "Farai", lastName: "Zvobgo", roles: ["system_admin"] });
  const op = await createAccount({ name: "Platform Operator", email: "platform@example.test", password: DEV_PASSWORD });
  await platformDb().insert(platformAdmin).values({ userId: op.userId });

  const dailyCount = await dbA.select().from(attendanceSession).where(eq(attendanceSession.kind, "daily"));
  const markCount = await dbA.select().from(attendanceMark);
  console.log(`
Seeded two schools (${dailyCount.length} daily registers, ${markCount.length} attendance marks at Kopje).
Password for every account: ${DEV_PASSWORD}

  Kopje Heights (kopje-heights)
    admin@kopje.example.test      School Administrator (setup, people, admissions, timetable)
    head@kopje.example.test       Headmaster (approvals, reports, discipline, indicators)
    teacher@kopje.example.test    Teacher + class teacher of 1 Blue (registers, marks, reports)
    teacher2@kopje.example.test   Teacher (English, Science, Physics)
    accounts@kopje.example.test   Accounts (fees, proofs of payment)
    library@kopje.example.test    Library
    parent@kopje.example.test     Parent of two children in 1 Blue
    rumbi.chikwanha               Student (username login)
  Umguza Valley (umguza-valley)
    admin@umguza.example.test     School Administrator
  Both schools
    support@multi.example.test    System Administrator (school picker)
  Platform
    platform@example.test         Platform Super Admin (no school records)
`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllSchoolDbs();
    await closePlatformDb();
  });
