import "server-only";
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { LRUCache } from "lru-cache";
import { Pool } from "pg";
import { platformDb } from "@/server/db/platform/client";
import { schoolDatabase } from "@/server/db/platform/schema";
import * as schoolSchema from "@/server/db/school/schema";
import { env } from "@/server/env";
import { REQUIRED_SCHOOL_SCHEMA_VERSION } from "./schema-version";
import { decryptSecret } from "./secrets";

export type SchoolDb = NodePgDatabase<typeof schoolSchema>;

/** Thrown when a school's database exists but is not on the schema this build needs. */
export class SchoolUnavailableError extends Error {
  constructor(
    readonly schoolId: string,
    readonly reason: "not_provisioned" | "schema_behind" | "identity_mismatch",
  ) {
    super(`School database unavailable (${reason})`);
    this.name = "SchoolUnavailableError";
  }
}

type Entry = { schoolId: string; pool: Pool; db: SchoolDb };

/**
 * One small pg pool per *active* school, held in a bounded LRU cache.
 * - Keyed ONLY by school UUID resolved server-side from platform_core.
 * - Evicted entries close their pool, so idle schools hold no connections.
 * - Each new entry proves which database it reached (school_identity) before use.
 */
function createCache() {
  return new LRUCache<string, Entry>({
    max: env().TENANT_CACHE_MAX_SCHOOLS,
    ttl: 10 * 60 * 1000,
    updateAgeOnGet: true,
    dispose: (entry) => {
      void entry.pool.end().catch(() => undefined);
    },
  });
}

const g = globalThis as unknown as {
  __schoolClients?: ReturnType<typeof createCache>;
  __schoolClientsPending?: Map<string, Promise<Entry>>;
};

function cache() {
  g.__schoolClients ??= createCache();
  return g.__schoolClients;
}
function pending() {
  g.__schoolClientsPending ??= new Map();
  return g.__schoolClientsPending;
}

async function open(schoolId: string): Promise<Entry> {
  const [row] = await platformDb()
    .select()
    .from(schoolDatabase)
    .where(eq(schoolDatabase.schoolId, schoolId))
    .limit(1);
  if (!row) throw new SchoolUnavailableError(schoolId, "not_provisioned");
  if (row.schemaVersion < REQUIRED_SCHOOL_SCHEMA_VERSION) {
    throw new SchoolUnavailableError(schoolId, "schema_behind");
  }

  const pool = new Pool({
    host: row.host,
    port: row.port,
    database: row.databaseName,
    user: row.roleName,
    password: decryptSecret(row.encryptedPassword, env().SCHOOL_DB_ENCRYPTION_KEY),
    max: env().TENANT_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "zsp-school",
  });

  try {
    const res = await pool.query<{ school_id: string }>("select school_id from school_identity");
    if (res.rows.length !== 1 || res.rows[0]!.school_id !== schoolId) {
      throw new SchoolUnavailableError(schoolId, "identity_mismatch");
    }
  } catch (e) {
    await pool.end().catch(() => undefined);
    throw e;
  }

  return { schoolId, pool, db: drizzle(pool, { schema: schoolSchema }) };
}

/**
 * Returns the database handle for a school. Callers outside src/server/tenancy must not use
 * this directly: go through requireSchoolContext(), which verifies membership first.
 */
export async function getSchoolDb(schoolId: string): Promise<SchoolDb> {
  const hit = cache().get(schoolId);
  if (hit) return hit.db;

  // Coalesce concurrent first requests for the same school into one pool.
  let p = pending().get(schoolId);
  if (!p) {
    p = open(schoolId)
      .then((entry) => {
        cache().set(schoolId, entry);
        return entry;
      })
      .finally(() => pending().delete(schoolId));
    pending().set(schoolId, p);
  }
  return (await p).db;
}

/** Drop a school's pool (after suspension, credential rotation or a move to another server). */
export function evictSchoolDb(schoolId: string): void {
  cache().delete(schoolId);
}

export async function closeAllSchoolDbs(): Promise<void> {
  const c = cache();
  const entries = [...c.values()];
  c.clear(); // dispose() ends pools
  await Promise.all(entries.map((e) => e.pool.end().catch(() => undefined)));
}

export function schoolCacheStats() {
  return { size: cache().size, max: cache().max };
}
