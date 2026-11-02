import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Client } from "pg";

/** Runs platform migrations as the owner role, then (re)applies least-privilege grants. */
export async function migratePlatform(): Promise<void> {
  const migratorUrl = process.env.PLATFORM_MIGRATOR_URL;
  const appUrl = process.env.PLATFORM_DATABASE_URL;
  if (!migratorUrl || !appUrl) throw new Error("PLATFORM_MIGRATOR_URL and PLATFORM_DATABASE_URL are required");
  const appRole = decodeURIComponent(new URL(appUrl).username);
  const dbName = new URL(migratorUrl).pathname.slice(1);

  const c = new Client({ connectionString: migratorUrl, application_name: "zsp-migrator" });
  await c.connect();
  try {
    await migrate(drizzle(c), { migrationsFolder: path.join(process.cwd(), "drizzle", "platform") });
    const role = c.escapeIdentifier(appRole);
    await c.query("BEGIN");
    await c.query(`REVOKE ALL ON DATABASE ${c.escapeIdentifier(dbName)} FROM PUBLIC`);
    await c.query(`GRANT CONNECT ON DATABASE ${c.escapeIdentifier(dbName)} TO ${role}`);
    await c.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await c.query(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE platform_audit_event FROM ${role}`);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}
