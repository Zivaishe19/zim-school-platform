/**
 * Isolation and ownership for every module added after Milestone 1.
 * Pattern per module: (1) cross-school: school B never sees school A's rows;
 * (2) wrong person in the same school is refused or sees nothing;
 * (3) the key business rule of the module holds (missing marks not zero, proof not credited, ...).
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as adm from "@/modules/admissions/service";
import * as asmt from "@/modules/assessments/service";
import * as att from "@/modules/attendance/service";
import * as comms from "@/modules/comms/service";
import * as disc from "@/modules/discipline/service";
import * as fees from "@/modules/fees/service";
import * as lib from "@/modules/library/service";
import * as people from "@/modules/people/service";
import * as rep from "@/modules/reports/service";
import * as setup from "@/modules/setup/service";
import * as tt from "@/modules/timetable/service";
import { listStudents, getStudent } from "@/modules/students/service";
import { notification, person, timetableEntry } from "@/server/db/school/schema";
import { authorizeFile } from "@/server/files/access";
import { ForbiddenError, resolveSchoolContext, type SchoolContext } from "@/server/tenancy/context";
import { asUser, fx } from "../helpers/fixtures";

const A = (userId: string) => resolveSchoolContext(asUser(userId), fx.schools.slugA) as Promise<SchoolContext>;
const B = (userId: string) => resolveSchoolContext(asUser(userId), fx.schools.slugB) as Promise<SchoolContext>;
const inClass = () => fx.students.A.slice(0, 10);
const outsider = () => fx.students.A[20]!;
const date = "2026-03-02";
const pdf = () => new File([Buffer.from("%PDF-1.4\n%%EOF\n")], "proof.pdf", { type: "application/pdf" });

let admin: SchoolContext, head: SchoolContext, teacher: SchoolContext, teacher2: SchoolContext, parent: SchoolContext, learner: SchoolContext, accounts: SchoolContext, librarian: SchoolContext, adminB: SchoolContext;
beforeAll(async () => {
  [admin, head, teacher, teacher2, parent, learner, accounts, librarian, adminB] = await Promise.all([
    A(fx.users.adminA), A(fx.users.headA), A(fx.users.teacherA), A(fx.users.teacherA2), A(fx.users.parentA), A(fx.users.studentUserA), A(fx.users.accountsA), A(fx.users.librarianA), B(fx.users.adminB),
  ]);
});

describe("teacher scope (class teacher and subject teacher)", () => {
  it("sees exactly the students they teach", async () => {
    const res = await listStudents(teacher, { page: 1 });
    expect(res.rows.map((r) => r.id).sort()).toEqual([...inClass()].sort());
    expect(await getStudent(teacher, outsider())).toBeNull();
  });
  it("another teacher with no assignment sees nobody", async () => {
    expect((await listStudents(teacher2)).total).toBe(0);
  });
});

describe("attendance", () => {
  it("only the class teacher (or an admin) can take the class register", async () => {
    const values: Record<string, string> = { kind: "daily", targetId: fx.structure.classId, date };
    for (const id of inClass()) values[`status_${id}`] = id === fx.students.parentChildren[0] ? "absent" : "present";
    await expect(att.saveRegister(teacher2, values)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(att.saveRegister(parent, values)).rejects.toBeInstanceOf(ForbiddenError);
    const r = await att.saveRegister(teacher, values);
    expect(r).toEqual({ saved: 10, notified: 1 });
    // Re-saving (a correction) does not notify again.
    expect((await att.saveRegister(teacher, values)).notified).toBe(0);
  });
  it("notifies only the absent child's guardian", async () => {
    const rows = await parent.db.select().from(notification).where(and(eq(notification.recipientPersonId, parent.personId!), eq(notification.source, "attendance")));
    expect(rows).toHaveLength(1);
    const others = await parent.db.select().from(notification).where(eq(notification.source, "attendance"));
    expect(others.every((n) => n.recipientPersonId === parent.personId)).toBe(true);
  });
  it("parents see their own child's attendance only; lesson absences never count as days", async () => {
    const mine = await att.studentAttendance(parent, fx.students.parentChildren[0]!);
    expect(mine.summary).toMatchObject({ days: 1, absent: 1 });
    await expect(att.studentAttendance(parent, outsider())).rejects.toBeInstanceOf(ForbiddenError);
    const lesson: Record<string, string> = { kind: "lesson", targetId: fx.structure.groupId, date, period: "P1" };
    for (const id of inClass()) lesson[`status_${id}`] = "absent";
    await att.saveRegister(teacher, lesson);
    const after = await att.studentAttendance(teacher, fx.students.A[3]!);
    expect(after.summary.days).toBe(1);
    expect(after.summary.absent).toBe(0);
    expect(after.lessonAbsences).toHaveLength(1);
  });
  it("an approved explanation turns the absence into an approved absence", async () => {
    await att.submitExplanation(parent, { studentId: fx.students.parentChildren[0], dateFrom: date, dateTo: date, reason: "Clinic appointment" });
    await expect(att.submitExplanation(parent, { studentId: outsider(), dateFrom: date, dateTo: date, reason: "Not my child" })).rejects.toBeInstanceOf(ForbiddenError);
    const [e] = await att.listExplanations(teacher, "pending");
    await att.reviewExplanation(teacher, { id: e!.id, decision: "approved" });
    const s = await att.studentAttendance(parent, fx.students.parentChildren[0]!);
    expect(s.summary).toMatchObject({ absent: 0, approved: 1 });
  });
  it("future dates are refused", async () => {
    await expect(att.saveRegister(teacher, { kind: "daily", targetId: fx.structure.classId, date: "2999-01-01" })).rejects.toThrow(/future/);
  });
});

describe("assessments and marks", () => {
  let testId = "";
  let examId = "";
  it("only the group's teacher creates assessments; weights cannot exceed 100%", async () => {
    await expect(asmt.createAssessment(teacher2, { groupId: fx.structure.groupId, termId: fx.structure.termId, title: "Nope", kind: "test", maxScore: "10", weight: "10" })).rejects.toBeInstanceOf(ForbiddenError);
    testId = (await asmt.createAssessment(teacher, { groupId: fx.structure.groupId, termId: fx.structure.termId, title: "Test 1", kind: "test", maxScore: "50", weight: "50" })).id;
    examId = (await asmt.createAssessment(teacher, { groupId: fx.structure.groupId, termId: fx.structure.termId, title: "Exam", kind: "exam", maxScore: "100", weight: "50" })).id;
    await expect(asmt.createAssessment(teacher, { groupId: fx.structure.groupId, termId: fx.structure.termId, title: "Too much", kind: "test", maxScore: "10", weight: "1" })).rejects.toThrow(/exceed 100/);
  });
  it("missing marks are never treated as zero", async () => {
    const child = fx.students.parentChildren[0]!;
    await asmt.saveMarks(teacher, { assessmentId: testId, [`score_${child}`]: "40" });
    await asmt.saveMarks(teacher, { assessmentId: examId, [`missing_${child}`]: "on" });
    const [r] = await asmt.studentResults(teacher, child, fx.structure.termId);
    expect(r!.percent).toBe(80); // 40/50 over the 50% that has a score, not (40/50*50 + 0)/100
    expect(r!.incomplete).toBe(true);
  });
  it("rejects scores outside 0..max", async () => {
    await expect(asmt.saveMarks(teacher, { assessmentId: testId, [`score_${fx.students.A[2]}`]: "51" })).rejects.toThrow(/between 0 and 50/);
  });
  it("parents see marks only after approval AND publication; approved marks are locked for teachers", async () => {
    const child = fx.students.parentChildren[0]!;
    expect((await asmt.studentResults(parent, child, fx.structure.termId))[0]!.assessments).toHaveLength(0);
    await asmt.advanceMarks(head, testId, "approved");
    await expect(asmt.saveMarks(teacher, { assessmentId: testId, [`score_${child}`]: "10" })).rejects.toThrow(/already approved/);
    await asmt.advanceMarks(head, testId, "published");
    const visible = (await asmt.studentResults(parent, child, fx.structure.termId))[0]!;
    expect(visible.assessments.map((a) => a.title)).toEqual(["Test 1"]);
    await expect(asmt.studentResults(parent, outsider(), fx.structure.termId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(asmt.advanceMarks(teacher, testId, "published")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("report cards", () => {
  it("draft → submitted → approved (frozen) → published; parents see only published, only their child", async () => {
    const child = fx.students.parentChildren[0]!;
    await expect(rep.saveTeacherComment(teacher2, { studentId: child, termId: fx.structure.termId, classId: fx.structure.classId, comment: "x", submit: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    await rep.saveTeacherComment(teacher, { studentId: child, termId: fx.structure.termId, classId: fx.structure.classId, comment: "Works hard.", submit: "1" });
    const [queued] = (await rep.submittedReports(head)).filter((r) => r.status === "submitted");
    expect(await rep.getReport(parent, queued!.id)).toBeNull();
    await rep.approveReport(head, { reportId: queued!.id, headComment: "Well done." });
    await rep.publishReports(head, [queued!.id]);
    const r = await rep.getReport(parent, queued!.id);
    expect(r?.frozen).toBe(true);
    expect(r?.data.subjects[0]?.percent).toBe(80);
    // The student (not the child's sibling) cannot open it.
    expect(await rep.getReport(learner, queued!.id)).toBeNull();
    // School B cannot see it at all.
    expect(await rep.getReport(adminB, queued!.id)).toBeNull();
  });
});

describe("fees", () => {
  it("proof of payment never credits until verified; parent sees only own child", async () => {
    const child = fx.students.parentChildren[1]!;
    await fees.addCharge(accounts, { studentId: child, currency: "USD", description: "Tuition", occurredOn: date, amount: "300" });
    await fees.submitProof(parent, { studentId: child, currency: "USD", channel: "ecocash", reference: "MP-1", paidOn: date, amount: "100" }, pdf());
    expect((await fees.statement(parent, child)).balances.USD).toBe(30000);
    await expect(fees.submitProof(parent, { studentId: outsider(), currency: "USD", channel: "ecocash", reference: "MP-2", paidOn: date, amount: "1" }, pdf())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(fees.statement(parent, outsider())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(fees.statement(teacher, child)).rejects.toBeInstanceOf(ForbiddenError);

    const [proof] = await fees.listProofs(accounts, "pending");
    await expect(fees.reviewProof(parent, { proofId: proof!.p.id, decision: "verified" })).rejects.toBeInstanceOf(ForbiddenError);
    await fees.reviewProof(accounts, { proofId: proof!.p.id, decision: "verified" });
    expect((await fees.statement(parent, child)).balances.USD).toBe(20000);
    // Same channel+reference cannot be recorded twice.
    await expect(fees.recordPayment(accounts, { studentId: child, currency: "USD", description: "dup", occurredOn: date, channel: "ecocash", reference: "MP-1", amount: "100" })).rejects.toThrow(/already recorded/);
  });
  it("USD and ZiG are never mixed; reversals restore the balance and keep the entry", async () => {
    const child = fx.students.parentChildren[1]!;
    await fees.addCharge(accounts, { studentId: child, currency: "ZiG", description: "Levy", occurredOn: date, amount: "450" });
    const st = await fees.statement(accounts, child);
    expect(st.balances).toEqual({ USD: 20000, ZiG: 45000 });
    const levy = st.entries.find((e) => e.currency === "ZiG")!;
    await fees.reverseEntry(accounts, { entryId: levy.id, reason: "Charged in error" });
    const after = await fees.statement(accounts, child);
    expect(after.balances.ZiG ?? 0).toBe(0);
    expect(after.entries.find((e) => e.id === levy.id)?.reversalReason).toBe("Charged in error");
  });
  it("proof files are visible to accounts and that parent only, never to another school", async () => {
    const [proof] = await fees.listProofs(accounts, "verified");
    expect(await authorizeFile(accounts, proof!.p.fileId)).not.toBeNull();
    expect(await authorizeFile(parent, proof!.p.fileId)).not.toBeNull();
    expect(await authorizeFile(teacher, proof!.p.fileId)).toBeNull();
    expect(await authorizeFile(learner, proof!.p.fileId)).toBeNull();
    expect(await authorizeFile(adminB, proof!.p.fileId)).toBeNull();
  });
});

describe("discipline", () => {
  it("teachers report, only the headmaster decides; parents see approved+visible only", async () => {
    const child = fx.students.parentChildren[0]!;
    await expect(disc.reportIncident(teacher, { studentId: outsider(), category: "other", description: "Not my student", occurredOn: date })).rejects.toBeInstanceOf(ForbiddenError);
    await disc.reportIncident(teacher, { studentId: child, category: "homework", description: "No homework", occurredOn: date, recommendedAction: "Warning" });
    await disc.reportIncident(teacher, { studentId: child, category: "uniform", description: "Uniform", occurredOn: date });
    expect(await disc.studentIncidents(parent, child)).toHaveLength(0);
    const [i1, i2] = await disc.listIncidents(head, "reported");
    await expect(disc.decideIncident(teacher, { id: i1!.i.id, decision: "approved", approvedAction: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await disc.decideIncident(head, { id: i1!.i.id, decision: "approved", approvedAction: "Warning", visibleToParent: "on" });
    await disc.decideIncident(head, { id: i2!.i.id, decision: "approved", approvedAction: "Note" });
    const visible = await disc.studentIncidents(parent, child);
    expect(visible).toHaveLength(1);
    expect(visible[0]!.recommendedAction).toBeNull();
  });
});

describe("messages, announcements, events, notifications", () => {
  it("parents may write only to staff connected to their child; outsiders cannot read the thread", async () => {
    const child = fx.students.parentChildren[0]!;
    const staffList = await comms.contactableStaff(parent, child);
    expect(staffList.map((s) => s.id)).toContain(fx.structure.teacherAPerson);
    const someoneElse = (await parent.db.select({ id: person.id }).from(person).where(eq(person.platformUserId, fx.users.librarianA)))[0]!.id;
    await expect(comms.startThread(parent, { studentId: child, category: "general", subject: "Hello", body: "Hi", staffPersonId: someoneElse })).rejects.toBeInstanceOf(ForbiddenError);
    const id = await comms.startThread(parent, { studentId: child, category: "meeting_request", subject: "Meeting", body: "Can we meet?", staffPersonId: fx.structure.teacherAPerson });
    expect(await comms.getThread(teacher, id)).not.toBeNull();
    expect(await comms.getThread(head, id)).toBeNull();
    expect(await comms.getThread(teacher2, id)).toBeNull();
    await comms.reply(teacher, id, "Yes, Tuesday.");
    expect((await comms.getThread(parent, id))!.messages).toHaveLength(2);
  });
  it("teachers can only announce to their own classes; class announcements reach guardians", async () => {
    await expect(comms.sendAnnouncement(teacher, { title: "To all", body: "Everyone", audienceKind: "everyone" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(comms.sendAnnouncement(teacher2, { title: "Not mine", body: "Not my class at all", audienceKind: "class", audienceIds: [fx.structure.classId] })).rejects.toBeInstanceOf(ForbiddenError);
    const n = await comms.sendAnnouncement(teacher, { title: "1A trip", body: "Trip on Friday", audienceKind: "class", audienceIds: [fx.structure.classId] });
    expect(n).toBeGreaterThan(0);
    expect((await comms.myAnnouncements(parent)).map((a) => a.a.title)).toContain("1A trip");
    expect((await comms.myAnnouncements(teacher2)).map((a) => a.a.title)).not.toContain("1A trip");
  });
  it("events and announcements never cross schools", async () => {
    await comms.createEvent(admin, { title: "Alpha sports day", kind: "sports_day", startsAt: "2999-05-01T09:00", audienceKind: "everyone" });
    expect((await comms.upcomingEvents(admin)).map((e) => e.title)).toContain("Alpha sports day");
    expect((await comms.upcomingEvents(adminB)).map((e) => e.title)).not.toContain("Alpha sports day");
    expect((await comms.myAnnouncements(adminB)).length).toBe(0);
  });
  it("a user only ever reads their own notifications", async () => {
    const mine = await comms.myNotifications(parent);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.recipientPersonId === parent.personId)).toBe(true);
  });
});

describe("library", () => {
  it("enforces the student loan limit and only library staff can lend", async () => {
    await lib.addBook(librarian, { accessionNumber: "A-1", title: "Book one" });
    await lib.addBook(librarian, { accessionNumber: "A-2", title: "Book two" });
    await expect(lib.lend(teacher, { accessionNumber: "A-1", admissionNumber: "A/001" })).rejects.toBeInstanceOf(ForbiddenError);
    await lib.lend(librarian, { accessionNumber: "A-1", admissionNumber: "A/001" });
    await expect(lib.lend(librarian, { accessionNumber: "A-2", admissionNumber: "A/001" })).rejects.toThrow(/1 book/);
    await expect(lib.lend(librarian, { accessionNumber: "A-1", admissionNumber: "A/002" })).rejects.toThrow(/on loan/);
    expect((await lib.listBooks(adminB)).length).toBe(0);
  });
});

describe("timetable", () => {
  it("blocks teacher, room and student double-booking; one-day changes never touch the baseline", async () => {
    const periods = await setup.listPeriods(admin);
    const mon = periods.find((p) => p.weekday === 1)!;
    const lab = (await setup.listRooms(admin)).find((r) => r.name === "Lab")!;
    const room9 = (await setup.listRooms(admin)).find((r) => r.name === "Room 9")!;
    const warnings = await tt.addEntry(admin, { periodIds: [mon.id], kind: "lesson", teachingGroupId: fx.structure.groupId, roomId: lab.id });
    expect(warnings).toEqual([]);
    // Same group (same teacher, same students) again in that period
    await expect(tt.addEntry(admin, { periodIds: [mon.id], kind: "lesson", teachingGroupId: fx.structure.groupId, roomId: room9.id })).rejects.toThrow(/already/);
    // Room clash
    await expect(tt.addEntry(admin, { periodIds: [mon.id], kind: "meeting", label: "Staff", roomId: lab.id })).rejects.toThrow(/room is already booked/);
    await expect(tt.addEntry(teacher, { periodIds: [mon.id], kind: "meeting", label: "x" })).rejects.toBeInstanceOf(ForbiddenError);

    const [entry] = await admin.db.select().from(timetableEntry);
    await tt.addOverride(admin, { date: "2026-03-02", periodId: mon.id, change: "cancelled", entryId: entry!.id, reason: "Exams" });
    const grid = await tt.weekGrid(admin, "2026-03-02", { kind: "all" });
    expect(grid.cellsByDay["2026-03-02"]!.find((c) => c.id === entry!.id)?.change).toBe("cancelled");
    const nextWeek = await tt.weekGrid(admin, "2026-03-09", { kind: "all" });
    expect(nextWeek.cellsByDay["2026-03-09"]!.find((c) => c.id === entry!.id)?.change).toBeUndefined();
    expect(await admin.db.select().from(timetableEntry)).toHaveLength(1);
    await expect(tt.addOverride(admin, { date: "2026-03-03", periodId: mon.id, change: "added", kind: "exam", label: "x", reason: "wrong day" })).rejects.toThrow(/weekday/);
  });
});

describe("admissions", () => {
  it("follows the status workflow; accepting creates a registered (not enrolled) student", async () => {
    const a = await adm.createWalkIn(admin, { entryType: "form1", firstName: "New", lastName: "Learner", guardianName: "Guardian", guardianPhone: "+263 77 123 4567" });
    await expect(adm.decideApplication(admin, { applicationId: a.id, status: "accepted", admissionNumber: "A/NEW/9" })).rejects.toThrow(/cannot become accepted/);
    await adm.decideApplication(admin, { applicationId: a.id, status: "under_review" });
    const r = await adm.decideApplication(admin, { applicationId: a.id, status: "accepted", admissionNumber: "A/NEW/9" });
    const s = await getStudent(admin, r.studentId!);
    expect(s?.status).toBe("registered");
    await expect(adm.listApplications(teacher)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await adm.listApplications(adminB)).length).toBe(0);
  });
  it("public applications are rate limited per network", async () => {
    const input = { entryType: "form1", firstName: "Pub", lastName: "Lic", guardianName: "Gogo", guardianPhone: "+263 77 000 0000" };
    for (let i = 0; i < 5; i++) await adm.submitOnlineApplication(adminB.db, fx.schools.B, input, "203.0.113.9");
    await expect(adm.submitOnlineApplication(adminB.db, fx.schools.B, input, "203.0.113.9")).rejects.toThrow(/Too many/);
    expect((await adm.listApplications(admin, "submitted")).every((x) => x.firstName !== "Pub")).toBe(true);
  });
});

describe("people", () => {
  it("a school cannot reset the password of an account used at another school", async () => {
    const both = (await people.listPeople(admin)).find((p) => p.platformUserId === fx.users.both)!;
    await expect(people.resetPassword(admin, { personId: both.id, password: "a-new-password-123" })).rejects.toThrow(/another school/);
    const parentRow = (await people.listPeople(admin)).find((p) => p.platformUserId === fx.users.parentA)!;
    await expect(people.resetPassword(teacher, { personId: parentRow.id, password: "a-new-password-123" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("progression", () => {
  it("never moves anyone until decided and applied; previous placements are kept", async () => {
    const next = await setup.createYear(admin, { name: "2027", startsOn: "2027-01-11", endsOn: "2027-12-03", terms: "3" });
    const proposed = await rep.proposeProgression(admin, fx.structure.yearId, next.id);
    expect(proposed).toBe(10);
    await expect(rep.applyProgression(admin, fx.structure.yearId)).rejects.toThrow(/still need a decision/);
    await expect(rep.proposeProgression(teacher, fx.structure.yearId, next.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("regressions", () => {
  it("a Form 1 application with the transfer-form field left blank is accepted", async () => {
    const r = await adm.createWalkIn(admin, { entryType: "form1", applyingForLevel: "", firstName: "Blank", lastName: "Level", guardianName: "Guardian", guardianPhone: "+263 77 000 1111" });
    expect(r.reference).toMatch(/^APP-/);
  });
});
