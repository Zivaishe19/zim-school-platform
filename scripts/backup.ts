/**
 * Encrypted backup of the platform database and every school database.
 *
 *   npm run backup                          -> ./backups/<UTC timestamp>/*.dump.enc + manifest.json
 *   npm run backup -- --out /mnt/backups
 *
 * Off-site upload (S3-compatible, separate account) is NOT wired yet: it needs bucket
 * credentials. See BACKUP_AND_RECOVERY.md.
 */
import "./lib/load-env";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { backupDatabase, backupKey } from "./lib/backup";

async function main() {
  const outArg = process.argv.indexOf("--out");
  const root = outArg > -1 ? process.argv[outArg + 1]! : path.join(process.cwd(), "backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(root, stamp);
  const key = backupKey();

  // Read the list of databases from platform_core (as the owner/migrator role).
  const platformName = new URL(process.env.PLATFORM_DATABASE_URL!).pathname.slice(1);
  const c = new Client({ connectionString: process.env.PLATFORM_MIGRATOR_URL });
  await c.connect();
  const schools = await c.query<{ database_name: string; slug: string }>(
    "select d.database_name, s.slug from school_database d join school s on s.id = d.school_id where s.status <> 'provisioning'",
  );
  await c.end();

  const manifest: { createdAt: string; files: { database: string; school?: string; file: string; bytes: number; sha256: string }[] } = {
    createdAt: new Date().toISOString(),
    files: [],
  };
  const targets = [{ database_name: platformName, slug: undefined as string | undefined }, ...schools.rows];
  let failed = 0;
  for (const t of targets) {
    try {
      const r = await backupDatabase(t.database_name, dir, key);
      manifest.files.push({ database: t.database_name, school: t.slug, file: path.basename(r.file), bytes: r.size, sha256: r.sha256 });
      console.log(`ok   ${t.database_name} ${r.size} bytes`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${t.database_name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(`backup written to ${dir}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
