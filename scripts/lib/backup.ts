/**
 * Encrypted logical backups, one file per database (platform + every school), so a single
 * school can be restored without touching any other school.
 *
 * File format (.dump.enc): "ZSPB1" | 12-byte IV | AES-256-GCM ciphertext of `pg_dump -Fc` | 16-byte tag
 * Key: BACKUP_ENCRYPTION_KEY (32 bytes, base64). Keep it OUT of the backup storage account.
 */
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("ZSPB1");
const IV_LEN = 12;
const TAG_LEN = 16;

export function backupKey(): Buffer {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

function adminUrlFor(databaseName: string): string {
  const url = new URL(process.env.PROVISIONER_DATABASE_URL ?? "");
  if (!/^[a-z][a-z0-9_]*$/.test(databaseName)) throw new Error("bad database name");
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function run(cmd: string, args: string[], stdin?: NodeJS.ReadableStream) {
  const child = spawn(cmd, args, { stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += d));
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr.trim().slice(0, 500)}`))));
  });
  if (stdin) stdin.pipe(child.stdin!);
  return { child, done };
}

/** pg_dump -Fc | encrypt > file. Returns size and sha256 of the encrypted file. */
export async function backupDatabase(databaseName: string, outDir: string, key = backupKey()) {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${databaseName}.dump.enc`);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const hash = createHash("sha256");
  const out = createWriteStream(file, { mode: 0o600 });
  const tee = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  const header = Buffer.concat([MAGIC, iv]);
  hash.update(header);
  out.write(header);

  const dump = run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--dbname=${adminUrlFor(databaseName)}`]);
  await Promise.all([pipeline(dump.child.stdout!, cipher, tee, out, { end: false }), dump.done]);
  const tag = cipher.getAuthTag();
  hash.update(tag);
  await new Promise<void>((resolve, reject) => out.end(tag, (err?: Error | null) => (err ? reject(err) : resolve())));
  const { size } = await stat(file);
  return { file, size, sha256: hash.digest("hex") };
}

/** Decrypts a backup and restores it into a NEW database (never overwrites an existing one). */
export async function restoreDatabase(file: string, targetDatabase: string, key = backupKey()) {
  const fh = await open(file, "r");
  const { size } = await fh.stat();
  const head = Buffer.alloc(MAGIC.length + IV_LEN);
  await fh.read(head, 0, head.length, 0);
  const tag = Buffer.alloc(TAG_LEN);
  await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  await fh.close();
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a ZSPB1 backup file");

  const decipher = createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);

  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.PROVISIONER_DATABASE_URL });
  await admin.connect();
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [targetDatabase]);
    if (exists.rowCount) throw new Error(`Refusing to restore over existing database ${targetDatabase}`);
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(targetDatabase)} TEMPLATE template0`);
  } finally {
    await admin.end();
  }

  // Decrypt fully before pg_restore sees any byte: GCM authenticates only at the end, so a
  // tampered file must never be partially restored. Buffer to a pass-through that we only
  // start piping into pg_restore once the tag has verified.
  const plain = new PassThrough();
  const chunks: Buffer[] = [];
  await pipeline(
    createReadStream(file, { start: MAGIC.length + IV_LEN, end: size - TAG_LEN - 1 }),
    decipher,
    new Transform({
      transform(c, _e, cb) {
        chunks.push(c);
        cb();
      },
    }),
  );
  const restore = run(
    "pg_restore",
    ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${adminUrlFor(targetDatabase)}`],
    plain,
  );
  plain.end(Buffer.concat(chunks));
  await restore.done;
}
