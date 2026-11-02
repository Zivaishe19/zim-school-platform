import "server-only";
import { eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform/client";
import { platformAuditEvent, schoolMembership } from "@/server/db/platform/schema";
import { auditEvent, person, personRole } from "@/server/db/school/schema";
import type { RoleKey } from "@/server/rbac/roles";
import { getSchoolDb } from "./client-cache";

/**
 * Gives a platform user access to a school: membership in platform_core, plus a person
 * record and roles in the school's own database. Idempotent.
 * Not yet exposed in the UI (user management screens are Milestone 2).
 */
export async function addSchoolMember(params: {
  schoolId: string;
  userId: string;
  firstName: string;
  lastName: string;
  roles: RoleKey[];
  actorUserId?: string | null;
}): Promise<{ personId: string }> {
  await platformDb()
    .insert(schoolMembership)
    .values({ schoolId: params.schoolId, userId: params.userId, status: "active" })
    .onConflictDoUpdate({ target: [schoolMembership.userId, schoolMembership.schoolId], set: { status: "active" } });
  await platformDb().insert(platformAuditEvent).values({
    actorUserId: params.actorUserId ?? null,
    action: "school.membership.granted",
    targetType: "user",
    targetId: params.userId,
    schoolId: params.schoolId,
    context: { roles: params.roles },
  });

  const db = await getSchoolDb(params.schoolId);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: person.id }).from(person).where(eq(person.platformUserId, params.userId));
    const personId =
      existing?.id ??
      (
        await tx
          .insert(person)
          .values({ platformUserId: params.userId, firstName: params.firstName, lastName: params.lastName })
          .returning({ id: person.id })
      )[0]!.id;
    if (params.roles.length) {
      await tx
        .insert(personRole)
        .values(params.roles.map((roleKey) => ({ personId, roleKey, grantedBy: params.actorUserId ?? null })))
        .onConflictDoNothing();
    }
    await tx.insert(auditEvent).values({
      actorUserId: params.actorUserId ?? null,
      action: "person.roles.granted",
      targetType: "person",
      targetId: personId,
      context: { roles: params.roles },
    });
    return { personId };
  });
}
