import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileObject } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import type { SchoolContext } from "@/server/tenancy/context";

/**
 * Private file storage. Files are NEVER served from a public URL: downloads go through
 * /s/<school>/files/<id>, which authorizes against the record that owns the file.
 *
 * Driver: local disk under FILE_STORAGE_DIR (default ./storage, git-ignored), keyed
 * <schoolId>/<random uuid>. An S3-compatible driver is not implemented yet (needs bucket
 * credentials); the interface below is what it must provide.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

function root(): string {
  // Runtime-only location (not traced into the build output).
  return path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORAGE_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "storage"));
}

function pathFor(key: string): string {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new Error("bad storage key");
  const p = path.join(root(), key);
  if (!p.startsWith(root() + path.sep)) throw new Error("path traversal");
  return p;
}

/** Validates type by CONTENT (not name/extension), size, then stores and records the file. */
export async function storeUpload(
  ctx: SchoolContext,
  file: File | null | undefined,
  purpose: string,
  opts: { required?: boolean } = {},
): Promise<string | null> {
  if (!file || file.size === 0) {
    if (opts.required) throw new UserError("Please attach a file.");
    return null;
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new UserError("File is too large (maximum 5 MB).");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = ALLOWED.find((a) => a.test(buf));
  if (!kind) throw new UserError("Only PDF, JPEG, PNG or WebP files are accepted.");

  const key = `${ctx.school.id}/${randomUUID()}`;
  const target = pathFor(key);
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(/* turbopackIgnore: true */ target, buf, { mode: 0o600, flag: "wx" });

  const original = path.basename(file.name || `upload.${kind.ext}`).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const [row] = await ctx.db
    .insert(fileObject)
    .values({
      storageKey: key,
      originalName: original,
      mimeType: kind.mime,
      sizeBytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      purpose,
      uploadedBy: ctx.user.id,
    })
    .returning({ id: fileObject.id });
  return row!.id;
}

export async function readStored(ctx: SchoolContext, storageKey: string): Promise<Buffer> {
  // Keys are always prefixed with the owning school's id: refuse anything else.
  if (!storageKey.startsWith(`${ctx.school.id}/`)) throw new Error("file does not belong to this school");
  return readFile(/* turbopackIgnore: true */ pathFor(storageKey));
}
