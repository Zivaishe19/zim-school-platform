import "server-only";
import { and, eq, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { enrolment, groupMember, schoolClass, student, studentGuardian, teachingGroup } from "@/server/db/school/schema";
import { can, ForbiddenError, type SchoolContext } from "./context";

/**
 * THE student-visibility rule, as SQL over any column holding a student id.
 *   view_all     -> no restriction (undefined)
 *   view_taught  -> students in teaching groups I teach, or in classes where I'm class teacher
 *   view_linked  -> students linked to me as guardian
 *   view_self    -> my own student record
 * Several may apply (a teacher who is also a parent): they are OR-ed.
 * No applicable permission -> ForbiddenError.
 */
export function studentVisibility(ctx: SchoolContext, studentIdColumn: AnyColumn): SQL | undefined {
  if (can(ctx, "students.view_all")) return undefined;
  const me = ctx.personId;
  if (!me) throw new ForbiddenError();
  const parts: SQL[] = [];
  if (can(ctx, "students.view_taught")) {
    parts.push(
      inArray(
        studentIdColumn,
        ctx.db
          .select({ id: groupMember.studentId })
          .from(groupMember)
          .innerJoin(teachingGroup, eq(teachingGroup.id, groupMember.teachingGroupId))
          .where(eq(teachingGroup.teacherPersonId, me)),
      ),
      inArray(
        studentIdColumn,
        ctx.db
          .select({ id: enrolment.studentId })
          .from(enrolment)
          .innerJoin(schoolClass, eq(schoolClass.id, enrolment.classId))
          .where(and(eq(schoolClass.classTeacherPersonId, me), eq(enrolment.status, "active"))),
      ),
    );
  }
  if (can(ctx, "students.view_linked")) {
    parts.push(
      inArray(
        studentIdColumn,
        ctx.db.select({ id: studentGuardian.studentId }).from(studentGuardian).where(eq(studentGuardian.guardianPersonId, me)),
      ),
    );
  }
  if (can(ctx, "students.view_self")) {
    parts.push(inArray(studentIdColumn, ctx.db.select({ id: student.id }).from(student).where(eq(student.personId, me))));
  }
  if (!parts.length) throw new ForbiddenError("students.view_all");
  return or(...parts);
}

/** True if this user may see this one student. */
export async function canSeeStudent(ctx: SchoolContext, studentId: string): Promise<boolean> {
  const scope = studentVisibility(ctx, student.id);
  const rows = await ctx.db
    .select({ id: student.id })
    .from(student)
    .where(and(eq(student.id, studentId), scope ?? sql`true`))
    .limit(1);
  return rows.length === 1;
}

/** Throws (as not-found semantics for callers) unless the student is visible. */
export async function requireVisibleStudent(ctx: SchoolContext, studentId: string): Promise<void> {
  if (!(await canSeeStudent(ctx, studentId))) throw new ForbiddenError();
}

/** Students linked to the current user as guardian (portal). */
export async function myChildren(ctx: SchoolContext) {
  if (!ctx.personId) return [];
  return ctx.db
    .select({ id: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber })
    .from(studentGuardian)
    .innerJoin(student, eq(student.id, studentGuardian.studentId))
    .where(eq(studentGuardian.guardianPersonId, ctx.personId))
    .orderBy(student.firstName);
}

/** The current user's own student record, if they are a student. */
export async function myStudentRecord(ctx: SchoolContext) {
  if (!ctx.personId) return null;
  const [row] = await ctx.db.select().from(student).where(eq(student.personId, ctx.personId)).limit(1);
  return row ?? null;
}
