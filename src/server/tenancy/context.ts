import "server-only";
import { and, eq } from "drizzle-orm";
import { platformDb } from "@/server/db/platform/client";
import { school, schoolMembership } from "@/server/db/platform/schema";
import { person, personRole } from "@/server/db/school/schema";
import { hasPermission, isRoleKey, type Permission, type RoleKey } from "@/server/rbac/roles";
import { getSchoolDb, type SchoolDb } from "./client-cache";
import { isValidSlug } from "./names";

/**
 * Everything a school-scoped operation may use. Module services accept ONLY this object,
 * never a raw school id or database handle, so they cannot be pointed at another school.
 */
export type SchoolContext = {
  readonly user: { id: string; name: string };
  readonly school: { id: string; slug: string; name: string };
  /** This user's record inside the school database (null = member with no person record yet). */
  readonly personId: string | null;
  readonly roles: readonly RoleKey[];
  readonly db: SchoolDb;
};

export class ForbiddenError extends Error {
  constructor(readonly permission?: Permission) {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

/**
 * Pure resolution (no Next.js APIs) so it can be tested directly.
 * Returns null when the user has no ACTIVE membership in an ACTIVE school with this slug.
 * The slug is untrusted input: it only selects among the user's own memberships.
 */
export async function resolveSchoolContext(user: { id: string; name: string }, slug: string): Promise<SchoolContext | null> {
  if (!isValidSlug(slug)) return null;

  const [row] = await platformDb()
    .select({ id: school.id, slug: school.slug, name: school.name })
    .from(schoolMembership)
    .innerJoin(school, eq(school.id, schoolMembership.schoolId))
    .where(
      and(
        eq(schoolMembership.userId, user.id),
        eq(schoolMembership.status, "active"),
        eq(school.slug, slug),
        eq(school.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;

  const db = await getSchoolDb(row.id);
  const [p] = await db.select({ id: person.id }).from(person).where(eq(person.platformUserId, user.id)).limit(1);
  const roles = p
    ? (await db.select({ k: personRole.roleKey }).from(personRole).where(eq(personRole.personId, p.id)))
        .map((r) => r.k)
        .filter(isRoleKey)
    : [];

  return Object.freeze({ user: { id: user.id, name: user.name }, school: row, personId: p?.id ?? null, roles, db });
}

export function can(ctx: SchoolContext, permission: Permission): boolean {
  return hasPermission(ctx.roles, permission);
}

export function assertCan(ctx: SchoolContext, permission: Permission): void {
  if (!can(ctx, permission)) throw new ForbiddenError(permission);
}

/** Schools the signed-in user can open (for the school picker). */
export async function listMySchools(userId: string) {
  return platformDb()
    .select({ slug: school.slug, name: school.name })
    .from(schoolMembership)
    .innerJoin(school, eq(school.id, schoolMembership.schoolId))
    .where(and(eq(schoolMembership.userId, userId), eq(schoolMembership.status, "active"), eq(school.status, "active")))
    .orderBy(school.name);
}
