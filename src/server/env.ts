import "server-only";
import { z } from "zod";

/**
 * Server-side environment, validated once at startup.
 * Nothing in here may ever be imported by client components ("server-only" enforces it).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PLATFORM_DATABASE_URL: z.string().url(),
  SCHOOL_DB_HOST: z.string().min(1),
  SCHOOL_DB_PORT: z.coerce.number().int().positive(),
  SCHOOL_DB_PREFIX: z.string().regex(/^[a-z][a-z0-9_]*$/),
  SCHOOL_DB_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  TENANT_CACHE_MAX_SCHOOLS: z.coerce.number().int().positive().default(200),
  TENANT_POOL_MAX: z.coerce.number().int().positive().default(3),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  /** Header carrying the real client IP, set (and overwritten) by OUR load balancer/proxy. */
  AUTH_CLIENT_IP_HEADER: z.string().min(1).default("x-forwarded-for"),
  AUTH_SIGNIN_MAX_PER_MINUTE: z.coerce.number().int().positive().default(5),
  /** Failed sign-ins for one account within 15 minutes before it is temporarily locked. */
  AUTH_ACCOUNT_LOCKOUT_FAILURES: z.coerce.number().int().positive().default(10),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      // Do not print values: they are secrets.
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment. Check: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}
