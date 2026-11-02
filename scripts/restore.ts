/**
 * Restores ONE encrypted backup file into a NEW database. It never overwrites a database:
 * restore beside the live one, verify, then switch the school's routing row
 * (see BACKUP_AND_RECOVERY.md, "Restore one school").
 *
 *   npm run restore -- backups/<stamp>/school_0001.dump.enc school_0001_restored
 */
import "./lib/load-env";
import { restoreDatabase } from "./lib/backup";

async function main() {
  const [file, target] = process.argv.slice(2);
  if (!file || !target || !/^[a-z][a-z0-9_]{0,62}$/.test(target)) {
    throw new Error("usage: restore <file.dump.enc> <new_database_name>");
  }
  await restoreDatabase(file, target);
  console.log(`restored ${file} into ${target}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
