import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/server/env";
import * as schema from "./schema";

export type PlatformDb = NodePgDatabase<typeof schema>;

type Holder = { pool: Pool; db: PlatformDb };

// Survive Next.js dev hot reloads without leaking pools.
const g = globalThis as unknown as { __platformDb?: Holder };

function create(): Holder {
  const pool = new Pool({
    connectionString: env().PLATFORM_DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    application_name: "zsp-platform",
  });
  return { pool, db: drizzle(pool, { schema }) };
}

export function platformDb(): PlatformDb {
  g.__platformDb ??= create();
  return g.__platformDb.db;
}

export async function closePlatformDb(): Promise<void> {
  if (g.__platformDb) {
    const { pool } = g.__platformDb;
    g.__platformDb = undefined;
    await pool.end();
  }
}

export { schema as platformSchema };
