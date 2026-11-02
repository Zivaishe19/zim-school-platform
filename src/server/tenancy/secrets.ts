import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for school database passwords stored in platform_core.
 * Format: v1.<iv b64>.<tag b64>.<ciphertext b64>
 * The key comes from SCHOOL_DB_ENCRYPTION_KEY (secrets manager in production).
 */
const VERSION = "v1";

function key(raw: string): Buffer {
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("SCHOOL_DB_ENCRYPTION_KEY must be 32 bytes (base64)");
  return k;
}

export function encryptSecret(plaintext: string, rawKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(envelope: string, rawKey: string): string {
  const [version, iv, tag, ct] = envelope.split(".");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unrecognised secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

/** 32 random bytes, URL-safe: used as a Postgres role password. */
export function generateDbPassword(): string {
  return randomBytes(32).toString("base64url");
}
