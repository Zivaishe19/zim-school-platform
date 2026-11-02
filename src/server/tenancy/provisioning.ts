import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { platformDb } from "@/server/db/platform/client";
import { platformAuditEvent, school, schoolDatabase, schoolMigrationRun } from "@/server/db/platform/schema";
import { env } from "@/server/env";
import {
  applySchoolGrants,
  ensureSchoolDatabase,
  ensureSchoolRole,
  migrateSchoolDatabase,
} from "./admin";
import { evictSchoolDb } from "./client-cache";
import { isValidSlug, schoolDatabaseName, schoolRoleName } from "./names";
import { decryptSecret, encryptSecret, generateDbPassword } from "./secrets";

export type ProvisionInput = { slug: string; name: string; actorUserId?: string | null };

/**
 * Creates (or resumes) a school: platform rows -> role -> database -> migrations -> grants
 * -> identity verified as the app role -> status active. Safe to re-run after a failure.
 */
export async function provisionSchool(input: ProvisionInput): Promise<{ schoolId: string; databaseName: string }> {
  if (!isValidSlug(input.slug)) throw new Error("Invalid slug: use 3-48 lowercase letters, digits and hyphens");
  const name = input.name.trim();
  if (name.length < 3 || name.length > 200) throw new Error("Invalid school name");

  const db = platformDb();
  const e = env();

  // Step 1: platform rows (serialised so school numbers are never handed out twice).
  const { schoolId, databaseName, roleName, password } = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('school_provisioning'))`);
    const [existing] = await tx.select().from(school).where(eq(school.slug, input.slug)).limit(1);
    if (existing) {
      if (existing.status !== "provisioning" && existing.status !== "provisioning_failed") {
        throw new Error(`School ${input.slug} already exists (${existing.status})`);
      }
      const [dbRow] = await tx.select().from(schoolDatabase).where(eq(schoolDatabase.schoolId, existing.id));
      if (!dbRow) throw new Error("Inconsistent provisioning state: school without database row");
      return {
        schoolId: existing.id,
        databaseName: dbRow.databaseName,
        roleName: dbRow.roleName,
        password: decryptSecret(dbRow.encryptedPassword, e.SCHOOL_DB_ENCRYPTION_KEY),
      };
    }

    const countRes = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ${schoolDatabase} where ${schoolDatabase.databaseName} like ${e.SCHOOL_DB_PREFIX + "%"}`,
    );
    const next = Number(countRes.rows[0]?.n ?? 0) + 1;
    const databaseName = schoolDatabaseName(e.SCHOOL_DB_PREFIX, next);
    const roleName = schoolRoleName(databaseName);
    const password = generateDbPassword();

    const [created] = await tx
      .insert(school)
      .values({ slug: input.slug, name, status: "provisioning" })
      .returning({ id: school.id });
    await tx.insert(schoolDatabase).values({
      schoolId: created!.id,
      host: e.SCHOOL_DB_HOST,
      port: e.SCHOOL_DB_PORT,
      databaseName,
      roleName,
      encryptedPassword: encryptSecret(password, e.SCHOOL_DB_ENCRYPTION_KEY),
    });
    await tx.insert(platformAuditEvent).values({
      actorUserId: input.actorUserId ?? null,
      action: "school.provision.started",
      targetType: "school",
      targetId: created!.id,
      schoolId: created!.id,
      context: { slug: input.slug, databaseName },
    });
    return { schoolId: created!.id, databaseName, roleName, password };
  });

  try {
    await ensureSchoolRole(roleName, password);
    await ensureSchoolDatabase(databaseName);
    const version = await runSchoolMigration(schoolId, databaseName, roleName);
    await verifyAsAppRole(schoolId);

    await db.transaction(async (tx) => {
      await tx
        .update(school)
        .set({ status: "active", statusDetail: null, updatedAt: new Date() })
        .where(eq(school.id, schoolId));
      await tx.insert(platformAuditEvent).values({
        actorUserId: input.actorUserId ?? null,
        action: "school.provision.completed",
        targetType: "school",
        targetId: schoolId,
        schoolId,
        context: { databaseName, schemaVersion: version },
      });
    });
    return { schoolId, databaseName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(school)
      .set({ status: "provisioning_failed", statusDetail: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(school.id, schoolId));
    await db.insert(platformAuditEvent).values({
      actorUserId: input.actorUserId ?? null,
      action: "school.provision.failed",
      targetType: "school",
      targetId: schoolId,
      schoolId,
      context: { error: message.slice(0, 500) },
    });
    throw err;
  }
}

/** Migrates one school, records the run, re-applies grants, updates schema_version. */
export async function runSchoolMigration(schoolId: string, databaseName: string, roleName: string): Promise<number> {
  const db = platformDb();
  const [current] = await db
    .select({ v: schoolDatabase.schemaVersion })
    .from(schoolDatabase)
    .where(eq(schoolDatabase.schoolId, schoolId));
  const [run] = await db
    .insert(schoolMigrationRun)
    .values({ schoolId, fromVersion: current?.v ?? 0, status: "running" })
    .returning({ id: schoolMigrationRun.id });
  try {
    const version = await migrateSchoolDatabase(databaseName, schoolId);
    await applySchoolGrants(databaseName, roleName);
    await db
      .update(schoolDatabase)
      .set({ schemaVersion: version, updatedAt: new Date() })
      .where(eq(schoolDatabase.schoolId, schoolId));
    await db
      .update(schoolMigrationRun)
      .set({ status: "succeeded", toVersion: version, finishedAt: new Date() })
      .where(eq(schoolMigrationRun.id, run!.id));
    evictSchoolDb(schoolId); // next request re-checks version with a fresh pool
    return version;
  } catch (err) {
    await db
      .update(schoolMigrationRun)
      .set({ status: "failed", error: String(err instanceof Error ? err.message : err).slice(0, 1000), finishedAt: new Date() })
      .where(eq(schoolMigrationRun.id, run!.id));
    throw err;
  }
}

/** Migrates every non-archived school in batches; stops if too many fail. */
export async function migrateAllSchools(opts: { batchSize?: number; maxFailures?: number } = {}) {
  const batchSize = opts.batchSize ?? 10;
  const maxFailures = opts.maxFailures ?? 3;
  const rows = await platformDb()
    .select({ schoolId: schoolDatabase.schoolId, databaseName: schoolDatabase.databaseName, roleName: schoolDatabase.roleName, slug: school.slug })
    .from(schoolDatabase)
    .innerJoin(school, eq(school.id, schoolDatabase.schoolId))
    .where(and(sql`${school.status} <> 'archived'`, sql`${school.status} <> 'provisioning'`));

  const results: { slug: string; ok: boolean; version?: number; error?: string }[] = [];
  let failures = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map((r) => runSchoolMigration(r.schoolId, r.databaseName, r.roleName)));
    settled.forEach((s, j) => {
      const r = batch[j]!;
      if (s.status === "fulfilled") results.push({ slug: r.slug, ok: true, version: s.value });
      else {
        failures++;
        results.push({ slug: r.slug, ok: false, error: String(s.reason instanceof Error ? s.reason.message : s.reason) });
      }
    });
    if (failures >= maxFailures) {
      results.push({ slug: "(rollout stopped)", ok: false, error: `${failures} failures reached the limit of ${maxFailures}` });
      break;
    }
  }
  return results;
}

/** Connects with the school's own least-privilege role and checks it reaches the right DB. */
async function verifyAsAppRole(schoolId: string): Promise<void> {
  const health = await checkSchoolHealth(schoolId);
  if (health.status !== "ok") throw new Error(`Post-provisioning check failed: ${health.status}`);
}

export type SchoolHealth = { schoolId: string; status: "ok" | "unreachable" | "identity_mismatch"; latencyMs: number; detail?: string };

/** Health probe used by provisioning and the db:health script. Records the result. */
export async function checkSchoolHealth(schoolId: string): Promise<SchoolHealth> {
  const db = platformDb();
  const [row] = await db.select().from(schoolDatabase).where(eq(schoolDatabase.schoolId, schoolId));
  if (!row) return { schoolId, status: "unreachable", latencyMs: 0, detail: "no database row" };
  const pool = new Pool({
    host: row.host,
    port: row.port,
    database: row.databaseName,
    user: row.roleName,
    password: decryptSecret(row.encryptedPassword, env().SCHOOL_DB_ENCRYPTION_KEY),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  const started = Date.now();
  let result: SchoolHealth;
  try {
    const r = await pool.query<{ school_id: string }>("select school_id from school_identity");
    result =
      r.rows.length === 1 && r.rows[0]!.school_id === schoolId
        ? { schoolId, status: "ok", latencyMs: Date.now() - started }
        : { schoolId, status: "identity_mismatch", latencyMs: Date.now() - started };
  } catch (err) {
    result = { schoolId, status: "unreachable", latencyMs: Date.now() - started, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    await pool.end().catch(() => undefined);
  }
  await db
    .update(schoolDatabase)
    .set({ lastHealthCheckAt: new Date(), healthStatus: result.status })
    .where(eq(schoolDatabase.schoolId, schoolId));
  return result;
}
