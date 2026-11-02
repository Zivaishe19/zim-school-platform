import "server-only";
import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 exports Algorithm as a const enum (unusable with isolatedModules): 2 = Argon2id.
const ARGON2ID = 2;

/**
 * Argon2id with OWASP-recommended minimum parameters (m=19 MiB, t=2, p=1).
 * The PHC string stores its own parameters, so these can be raised later and old hashes
 * still verify.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword({ hash: digest, password }: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(digest, password);
  } catch {
    return false;
  }
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
