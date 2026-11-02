import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { backupDatabase, restoreDatabase } from "../../scripts/lib/backup";
import { fx } from "../helpers/fixtures";

const key = randomBytes(32);
const restored: string[] = [];

async function admin<T>(db: string, fn: (c: Client) => Promise<T>) {
  const url = new URL(process.env.PROVISIONER_DATABASE_URL!);
  url.pathname = `/${db}`;
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

afterAll(async () => {
  await admin("postgres", async (c) => {
    for (const db of restored) await c.query(`DROP DATABASE IF EXISTS ${c.escapeIdentifier(db)} WITH (FORCE)`);
  });
});

describe("encrypted backup and single-school restore", () => {
  it("restores one school into a new database with identical data", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zsp-backup-"));
    const { file } = await backupDatabase(fx.schools.dbA, dir, key);

    const raw = await readFile(file);
    expect(raw.subarray(0, 5).toString()).toBe("ZSPB1");
    expect(raw.includes(Buffer.from("AFirst1"))).toBe(false); // student names are not readable

    const target = `${fx.schools.dbA}_restore_test`;
    restored.push(target);
    await restoreDatabase(file, target, key);

    const count = (db: string) => admin(db, async (c) => (await c.query("select count(*)::int n from student")).rows[0].n as number);
    const identity = (db: string) => admin(db, async (c) => (await c.query("select school_id from school_identity")).rows[0].school_id as string);
    expect(await count(target)).toBe(await count(fx.schools.dbA));
    expect(await identity(target)).toBe(fx.schools.A);
  });

  it("rejects a tampered or wrongly-keyed backup and never creates partial data", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zsp-backup-"));
    const { file } = await backupDatabase(fx.schools.dbB, dir, key);
    const raw = await readFile(file);
    raw[100] = raw[100]! ^ 0xff;
    const tampered = path.join(dir, "tampered.dump.enc");
    await writeFile(tampered, raw);

    const t1 = `${fx.schools.dbB}_tamper_test`;
    restored.push(t1);
    await expect(restoreDatabase(tampered, t1, key)).rejects.toThrow(/authenticate/i);
    const t2 = `${fx.schools.dbB}_wrongkey_test`;
    restored.push(t2);
    await expect(restoreDatabase(file, t2, randomBytes(32))).rejects.toThrow(/authenticate/i);
    const tables = await admin(t1, async (c) => (await c.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n);
    expect(tables).toBe(0);
  });

  it("refuses to restore over an existing database", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zsp-backup-"));
    const { file } = await backupDatabase(fx.schools.dbB, dir, key);
    await expect(restoreDatabase(file, fx.schools.dbA, key)).rejects.toThrow(/Refusing/);
  });
});
