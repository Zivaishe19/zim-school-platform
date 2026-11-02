import "server-only";
import { and, eq } from "drizzle-orm";
import { applicationDocument, assessment, fileObject, groupMember, learningMaterial, paymentProof, studentGuardian, submission, teachingGroup } from "@/server/db/school/schema";
import { can, type SchoolContext } from "@/server/tenancy/context";
import { myStudentRecord } from "@/server/tenancy/scope";

/**
 * A file is downloadable only through the record that owns it, and only if the user may see
 * that record. Unknown or not-allowed files return null (the route answers 404).
 */
export async function authorizeFile(ctx: SchoolContext, fileId: string) {
  const [f] = await ctx.db.select().from(fileObject).where(eq(fileObject.id, fileId));
  if (!f) return null;
  const me = ctx.personId;

  const [proof] = await ctx.db.select().from(paymentProof).where(eq(paymentProof.fileId, f.id));
  if (proof) {
    if (can(ctx, "fees.view_all")) return f;
    if (me && (await ctx.db.select().from(studentGuardian).where(and(eq(studentGuardian.studentId, proof.studentId), eq(studentGuardian.guardianPersonId, me)))).length) return f;
    return null;
  }
  const [doc] = await ctx.db.select().from(applicationDocument).where(eq(applicationDocument.fileId, f.id));
  if (doc) return can(ctx, "admissions.manage") ? f : null;

  const [sub] = await ctx.db
    .select({ s: submission, teacher: teachingGroup.teacherPersonId })
    .from(submission)
    .innerJoin(assessment, eq(assessment.id, submission.assessmentId))
    .innerJoin(teachingGroup, eq(teachingGroup.id, assessment.teachingGroupId))
    .where(eq(submission.fileId, f.id));
  if (sub) {
    if ((me && sub.teacher === me) || can(ctx, "marks.approve")) return f;
    const self = await myStudentRecord(ctx);
    if (self?.id === sub.s.studentId) return f;
    if (me && (await ctx.db.select().from(studentGuardian).where(and(eq(studentGuardian.studentId, sub.s.studentId), eq(studentGuardian.guardianPersonId, me)))).length) return f;
    return null;
  }
  const [mat] = await ctx.db.select().from(learningMaterial).where(eq(learningMaterial.fileId, f.id));
  if (mat) {
    if (can(ctx, "settings.manage") || can(ctx, "marks.approve")) return f;
    const [g] = await ctx.db.select().from(teachingGroup).where(eq(teachingGroup.id, mat.teachingGroupId));
    if (g?.teacherPersonId && g.teacherPersonId === me) return f;
    const self = await myStudentRecord(ctx);
    if (self && (await ctx.db.select().from(groupMember).where(and(eq(groupMember.teachingGroupId, mat.teachingGroupId), eq(groupMember.studentId, self.id)))).length) return f;
    if (me && can(ctx, "portal.guardian")) {
      const kids = await ctx.db.select({ id: groupMember.studentId }).from(groupMember).innerJoin(studentGuardian, eq(studentGuardian.studentId, groupMember.studentId)).where(and(eq(groupMember.teachingGroupId, mat.teachingGroupId), eq(studentGuardian.guardianPersonId, me)));
      if (kids.length) return f;
    }
    return null;
  }
  return null; // orphan files are never served
}
