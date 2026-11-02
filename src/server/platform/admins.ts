import "server-only";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { platformDb } from "@/server/db/platform/client";
import { platformAdmin, school, schoolDatabase } from "@/server/db/platform/schema";

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await platformDb().select({ u: platformAdmin.userId }).from(platformAdmin).where(eq(platformAdmin.userId, userId)).limit(1);
  return Boolean(row);
}

export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!(await isPlatformAdmin(user.id))) notFound();
  return user;
}

/** Platform-level view of schools. Deliberately contains NO school records (students, marks...). */
export async function listSchoolsForOperators() {
  return platformDb()
    .select({
      slug: school.slug,
      name: school.name,
      status: school.status,
      databaseName: schoolDatabase.databaseName,
      schemaVersion: schoolDatabase.schemaVersion,
      healthStatus: schoolDatabase.healthStatus,
      lastHealthCheckAt: schoolDatabase.lastHealthCheckAt,
    })
    .from(school)
    .leftJoin(schoolDatabase, eq(schoolDatabase.schoolId, school.id))
    .orderBy(school.name);
}
