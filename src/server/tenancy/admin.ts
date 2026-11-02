import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { z } from "zod";
import { assertSafeIdentifier } from "./names";
import { SCHOOL_MIGRATIONS_FOLDER } from "./schema-version";

/**
 * Privileged database operations: create school databases/roles, run migrations, apply grants.
 * Used ONLY by provisioning/migration jobs and CLI scripts, never by request handlers.
 * The provisioner credential is not part of the web app's environment schema.
 */
const adminEnv = z.object({ PROVISIONER_DATABASE_URL: z.string().url() });

function provisionerUrl(databaseName?: string): string {
  const { PROVISIONER_DATABASE_URL } = adminEnv.parse(process.env);
  const url = new URL(PROVISIONER_DATABASE_URL);
  if (databaseName) url.pathname = `/${assertSafeIdentifier(databaseName)}`;
  return url.toString();
}

export async function withAdminClient<T>(databaseName: string | undefined, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: provisionerUrl(databaseName), application_name: "zsp-provisioner" });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Idempotent: creates or re-keys the login role for a school. */
export async function ensureSchoolRole(roleName: string, password: string): Promise<void> {
  assertSafeIdentifier(roleName);
  await withAdminClient(undefined, async (c) => {
    const exists = await c.query("select 1 from pg_roles where rolname = $1", [roleName]);
    const verb = exists.rowCount ? "ALTER" : "CREATE";
    await c.query(
      `${verb} ROLE ${c.escapeIdentifier(roleName)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${c.escapeLiteral(password)}`,
    );
  });
}

/** Idempotent: CREATE DATABASE cannot run in a transaction, so check first. */
export async function ensureSchoolDatabase(databaseName: string): Promise<void> {
  assertSafeIdentifier(databaseName);
  await withAdminClient(undefined, async (c) => {
    const exists = await c.query("select 1 from pg_database where datname = $1", [databaseName]);
    if (!exists.rowCount) {
      await c.query(`CREATE DATABASE ${c.escapeIdentifier(databaseName)} ENCODING 'UTF8' TEMPLATE template0`);
    }
    // Nobody but the school's own role (and the admin) may connect.
    await c.query(`REVOKE ALL ON DATABASE ${c.escapeIdentifier(databaseName)} FROM PUBLIC`);
  });
}

/**
 * Least-privilege grants for a school's app role. Re-run after every migration so new
 * tables are covered. Audit table is append-only for the app role.
 */
export async function applySchoolGrants(databaseName: string, roleName: string): Promise<void> {
  assertSafeIdentifier(databaseName);
  assertSafeIdentifier(roleName);
  await withAdminClient(databaseName, async (c) => {
    const db = c.escapeIdentifier(databaseName);
    const role = c.escapeIdentifier(roleName);
    await c.query("BEGIN");
    try {
      await c.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
      await c.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${role}`);
      await c.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
      await c.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await c.query(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_event FROM ${role}`);
      await c.query(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE school_identity FROM ${role}`);
      await c.query(`REVOKE ALL ON SCHEMA drizzle FROM ${role}`).catch(() => undefined);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}

/**
 * Applies all pending school migrations to one database (as admin), writes the identity row
 * on first run, and returns the resulting schema version.
 */
export async function migrateSchoolDatabase(databaseName: string, schoolId: string): Promise<number> {
  return withAdminClient(databaseName, async (c) => {
    const db = drizzle(c);
    await migrate(db, { migrationsFolder: SCHOOL_MIGRATIONS_FOLDER });
    const existing = await c.query<{ school_id: string }>("select school_id from school_identity");
    if (existing.rowCount === 0) {
      await c.query("insert into school_identity (school_id) values ($1)", [schoolId]);
    } else if (existing.rows.length !== 1 || existing.rows[0]!.school_id !== schoolId) {
      throw new Error(`Database ${databaseName} belongs to a different school; refusing to continue`);
    }
    const v = await c.query<{ n: string }>("select count(*)::text as n from drizzle.__drizzle_migrations");
    return Number(v.rows[0]!.n);
  });
}
