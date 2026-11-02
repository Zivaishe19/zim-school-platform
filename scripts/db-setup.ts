/**
 * DEVELOPMENT/TEST bootstrap: creates the platform database and the least-privilege
 * platform_app role, then runs platform migrations and grants.
 * In staging/production the database and role are created by infrastructure; only
 * `npm run db:migrate:platform` runs there.
 *
 *   npm run db:setup              (uses .env)
 *   ENV_FILE=.env.test npm run db:setup
 */
import "./lib/load-env";
import { Client } from "pg";
import { migratePlatform } from "./lib/platform-migrate";

async function main() {
  const platformUrl = new URL(required("PLATFORM_DATABASE_URL"));
  const dbName = platformUrl.pathname.slice(1);
  const appRole = decodeURIComponent(platformUrl.username);
  const appPassword = required("PLATFORM_APP_PASSWORD");
  if (process.env.NODE_ENV === "production") throw new Error("db:setup is for development and test only");

  const admin = new Client({ connectionString: required("PROVISIONER_DATABASE_URL") });
  await admin.connect();
  try {
    const role = await admin.query("select 1 from pg_roles where rolname = $1", [appRole]);
    await admin.query(
      `${role.rowCount ? "ALTER" : "CREATE"} ROLE ${admin.escapeIdentifier(appRole)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${admin.escapeLiteral(appPassword)}`,
    );
    const db = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (!db.rowCount) {
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(dbName)} ENCODING 'UTF8' TEMPLATE template0`);
      console.log(`created database ${dbName}`);
    }
  } finally {
    await admin.end();
  }

  await migratePlatform();
  console.log(`platform database ${dbName} ready (app role: ${appRole})`);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
