/**
 * DEVELOPMENT/TEST ONLY: drops the platform database and every school database with the
 * configured prefix, plus their roles. Refuses to run in production.
 *
 *   npm run db:reset                 (then: npm run db:setup && npm run db:seed)
 */
import "./lib/load-env";
import { Client } from "pg";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset in production");
  const prefix = process.env.SCHOOL_DB_PREFIX;
  const platformDb = new URL(process.env.PLATFORM_DATABASE_URL ?? "").pathname.slice(1);
  if (!prefix || !/^[a-z_]+$/.test(prefix) || !platformDb) throw new Error("SCHOOL_DB_PREFIX / PLATFORM_DATABASE_URL missing");

  const c = new Client({ connectionString: process.env.PROVISIONER_DATABASE_URL });
  await c.connect();
  try {
    const dbs = await c.query<{ datname: string }>(
      "select datname from pg_database where datname like $1 or datname = $2",
      [`${prefix}%`, platformDb],
    );
    for (const { datname } of dbs.rows) {
      await c.query(`DROP DATABASE IF EXISTS ${c.escapeIdentifier(datname)} WITH (FORCE)`);
      console.log(`dropped ${datname}`);
    }
    const roles = await c.query<{ rolname: string }>("select rolname from pg_roles where rolname like $1", [`${prefix}%_app`]);
    for (const { rolname } of roles.rows) await c.query(`DROP ROLE IF EXISTS ${c.escapeIdentifier(rolname)}`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
