/**
 * Builds the isolation-test world from scratch in the TEST databases (.env.test):
 * two independently provisioned schools and users with every relevant relationship.
 * Writes ids to tests/.fixtures.json for the test files. Run by tests/global-setup.ts.
 */
import "../../scripts/lib/load-env";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createAccount } from "@/server/auth/accounts";
import { closePlatformDb, platformDb } from "@/server/db/platform/client";
import { platformAdmin } from "@/server/db/platform/schema";
import { student, studentGuardian } from "@/server/db/school/schema";
import { closeAllSchoolDbs, getSchoolDb } from "@/server/tenancy/client-cache";
import { addSchoolMember } from "@/server/tenancy/membership";
import { provisionSchool } from "@/server/tenancy/provisioning";
import { eq } from "drizzle-orm";
import { person } from "@/server/db/school/schema";
import { resolveSchoolContext } from "@/server/tenancy/context";
import * as setup from "@/modules/setup/service";

const PW = "Test-Password-123!";

async function main() {
  if (!process.env.PLATFORM_DATABASE_URL?.includes("_test")) throw new Error("Refusing: not a test database");

  const A = await provisionSchool({ slug: "alpha-high", name: "Alpha High (test)" });
  const B = await provisionSchool({ slug: "bravo-college", name: "Bravo College (test)" });
  const dbA = await getSchoolDb(A.schoolId);
  const dbB = await getSchoolDb(B.schoolId);

  const mk = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      admissionNumber: `${prefix}/${String(i + 1).padStart(3, "0")}`,
      firstName: `${prefix}First${i}`,
      lastName: `${prefix}Last${i}`,
      status: "enrolled" as const,
    }));
  const studentsA = await dbA.insert(student).values(mk("A", 30)).returning({ id: student.id });
  const studentsB = await dbB.insert(student).values(mk("B", 30)).returning({ id: student.id });

  const user = async (key: string, opts: { username?: string } = {}) =>
    (await createAccount({ name: `User ${key}`, ...(opts.username ? { username: opts.username } : { email: `${key}@test.invalid` }), password: PW })).userId;

  const headA = await user("head-a");
  await addSchoolMember({ schoolId: A.schoolId, userId: headA, firstName: "Head", lastName: "A", roles: ["headmaster"] });
  const adminA = await user("admin-a");
  await addSchoolMember({ schoolId: A.schoolId, userId: adminA, firstName: "Admin", lastName: "A", roles: ["school_admin"] });
  const adminB = await user("admin-b");
  await addSchoolMember({ schoolId: B.schoolId, userId: adminB, firstName: "Admin", lastName: "B", roles: ["school_admin"] });
  const both = await user("both");
  await addSchoolMember({ schoolId: A.schoolId, userId: both, firstName: "Both", lastName: "Schools", roles: ["system_admin"] });
  await addSchoolMember({ schoolId: B.schoolId, userId: both, firstName: "Both", lastName: "Schools", roles: ["system_admin"] });
  const teacherA = await user("teacher-a");
  await addSchoolMember({ schoolId: A.schoolId, userId: teacherA, firstName: "Teacher", lastName: "A", roles: ["teacher", "class_teacher"] });

  const parentA = await user("parent-a");
  const { personId: parentPerson } = await addSchoolMember({ schoolId: A.schoolId, userId: parentA, firstName: "Parent", lastName: "A", roles: ["parent"] });
  await dbA.insert(studentGuardian).values([
    { studentId: studentsA[0]!.id, guardianPersonId: parentPerson, relationship: "father" },
    { studentId: studentsA[1]!.id, guardianPersonId: parentPerson, relationship: "father" },
  ]);

  const studentUserA = await user("student-a", { username: "student.a" });
  const { personId: learnerPerson } = await addSchoolMember({ schoolId: A.schoolId, userId: studentUserA, firstName: "Learner", lastName: "A", roles: ["student"] });
  await dbA.update(student).set({ personId: learnerPerson }).where(eq(student.id, studentsA[5]!.id));

  const operator = await user("operator");
  await platformDb().insert(platformAdmin).values({ userId: operator });

  const teacherA2 = await user("teacher2-a");
  await addSchoolMember({ schoolId: A.schoolId, userId: teacherA2, firstName: "Teacher", lastName: "Two", roles: ["teacher"] });
  const accountsA = await user("accounts-a");
  await addSchoolMember({ schoolId: A.schoolId, userId: accountsA, firstName: "Accounts", lastName: "A", roles: ["accounts"] });
  const librarianA = await user("library-a");
  await addSchoolMember({ schoolId: A.schoolId, userId: librarianA, firstName: "Library", lastName: "A", roles: ["librarian"] });

  // Academic structure in A: one class (class teacher = teacherA) with students A[0..9],
  // a whole-class Maths group taught by teacherA. Parent's children (A[0], A[1]) and the
  // student user (A[5]) are in it. B gets its own year and class.
  const ctxA = (await resolveSchoolContext({ id: adminA, name: "Admin A" }, "alpha-high"))!;
  const year = await setup.createYear(ctxA, { name: "2026", startsOn: "2026-01-12", endsOn: "2026-12-04", terms: "3" });
  await setup.openYear(ctxA, year.id);
  const terms = await setup.listTerms(ctxA, year.id);
  await setup.setForms(ctxA, [1, 2]);
  const forms = await setup.listForms(ctxA);
  const teacherAPerson = (await ctxA.db.select({ id: person.id }).from(person).where(eq(person.platformUserId, teacherA)))[0]!.id;
  const cls = await setup.createClass(ctxA, { academicYearId: year.id, formId: forms[0]!.id, name: "1A", classTeacherPersonId: teacherAPerson });
  await setup.enrolStudents(ctxA, cls.id, studentsA.slice(0, 10).map((s) => s.id));
  await setup.createSubject(ctxA, { code: "4004", name: "Mathematics", examBoard: "zimsec", isPractical: "" });
  const subj = (await setup.listSubjects(ctxA))[0]!;
  const grp = await setup.createGroup(ctxA, { academicYearId: year.id, subjectId: subj.id, name: "1A Maths", formId: forms[0]!.id, classId: cls.id, teacherPersonId: teacherAPerson, addClassMembers: "on" });
  await setup.createRoom(ctxA, { name: "Lab", capacity: "5", kind: "laboratory" });
  await setup.createRoom(ctxA, { name: "Room 9", capacity: "40", kind: "classroom" });
  await setup.createPeriods(ctxA, { weekdays: ["1", "2", "3", "4", "5"], number: "1", label: "P1", startsAt: "08:00", endsAt: "08:40", kind: "lesson" });

  const ctxB = (await resolveSchoolContext({ id: adminB, name: "Admin B" }, "bravo-college"))!;
  const yearB = await setup.createYear(ctxB, { name: "2026", startsOn: "2026-01-12", endsOn: "2026-12-04", terms: "3" });
  await setup.setForms(ctxB, [1]);
  const clsB = await setup.createClass(ctxB, { academicYearId: yearB.id, formId: (await setup.listForms(ctxB))[0]!.id, name: "1B" });
  await setup.enrolStudents(ctxB, clsB.id, studentsB.slice(0, 10).map((s) => s.id));

  const fixtures = {
    schools: { A: A.schoolId, B: B.schoolId, slugA: "alpha-high", slugB: "bravo-college", dbA: A.databaseName, dbB: B.databaseName },
    users: { headA, adminA, adminB, both, teacherA, teacherA2, accountsA, librarianA, parentA, studentUserA, operator },
    structure: { yearId: year.id, termId: terms[0]!.id, classId: cls.id, groupId: grp.id, teacherAPerson },
    students: {
      A: studentsA.map((s) => s.id),
      B: studentsB.map((s) => s.id),
      parentChildren: [studentsA[0]!.id, studentsA[1]!.id],
      studentSelf: studentsA[5]!.id,
    },
    password: PW,
  };
  writeFileSync(path.join(process.cwd(), "tests", ".fixtures.json"), JSON.stringify(fixtures, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllSchoolDbs();
    await closePlatformDb();
  });
