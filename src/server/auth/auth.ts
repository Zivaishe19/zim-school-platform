import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { and, count, eq, gt } from "drizzle-orm";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";
import { platformDb } from "@/server/db/platform/client";
import * as platform from "@/server/db/platform/schema";
import { env } from "@/server/env";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "./password";

const SIGN_IN_PATHS = new Set(["/sign-in/email", "/sign-in/username"]);
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

function signInIdentifier(body: unknown): string | null {
  const b = (body ?? {}) as { email?: unknown; username?: unknown };
  const v = typeof b.email === "string" ? b.email : typeof b.username === "string" ? b.username : null;
  return v ? v.trim().toLowerCase().slice(0, 200) : null;
}

/**
 * Per-account brute-force protection, independent of IP (IPs can be shared by a whole
 * school's Wi-Fi, or spoofed). Counts recent failures recorded in the platform audit log,
 * so it holds across all app instances.
 */
async function recentFailures(identifier: string): Promise<number> {
  const [row] = await platformDb()
    .select({ n: count() })
    .from(platform.platformAuditEvent)
    .where(
      and(
        eq(platform.platformAuditEvent.action, "auth.login.failed"),
        eq(platform.platformAuditEvent.targetId, identifier),
        gt(platform.platformAuditEvent.at, new Date(Date.now() - LOCKOUT_WINDOW_MS)),
      ),
    );
  return row?.n ?? 0;
}

function build() {
  const e = env();
  return betterAuth({
    appName: "Zimbabwe School Platform",
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.BETTER_AUTH_URL,
    trustedOrigins: [e.BETTER_AUTH_URL],
    database: drizzleAdapter(platformDb(), {
      provider: "pg",
      schema: {
        user: platform.user,
        session: platform.session,
        account: platform.account,
        verification: platform.verification,
        twoFactor: platform.twoFactor,
        rateLimit: platform.rateLimit,
      },
    }),
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: e.NODE_ENV === "production",
      // Only trust the header our own proxy sets; it must overwrite any client-supplied value.
      ipAddress: { ipAddressHeaders: [e.AUTH_CLIENT_IP_HEADER] },
      cookiePrefix: "zsp",
    },
    user: {
      additionalFields: {
        mustChangePassword: { type: "boolean", defaultValue: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Accounts are created by schools (admissions, staff onboarding), never by self sign-up.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    session: {
      expiresIn: 60 * 60 * 12, // 12 hours
      updateAge: 60 * 60, // refresh at most hourly
      freshAge: 60 * 10, // sensitive actions need a login within 10 minutes
    },
    rateLimit: {
      enabled: true,
      storage: "database", // shared across app instances
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: e.AUTH_SIGNIN_MAX_PER_MINUTE },
        "/sign-in/username": { window: 60, max: e.AUTH_SIGNIN_MAX_PER_MINUTE },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 40 }),
      // MFA: tables and endpoints are live; the enrolment UI is Milestone 1b (see PROJECT_ROADMAP.md).
      twoFactor({ issuer: "Zimbabwe School Platform" }),
      nextCookies(), // must be last
    ],
    databaseHooks: {
      session: {
        create: {
          after: async (s) => {
            await platformDb().insert(platform.platformAuditEvent).values({
              actorUserId: s.userId,
              action: "auth.login.succeeded",
              targetType: "user",
              targetId: s.userId,
              ipAddress: s.ipAddress ?? null,
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!SIGN_IN_PATHS.has(ctx.path)) return;
        const identifier = signInIdentifier(ctx.body);
        if (identifier && (await recentFailures(identifier)) >= e.AUTH_ACCOUNT_LOCKOUT_FAILURES) {
          await platformDb().insert(platform.platformAuditEvent).values({
            action: "auth.login.locked_out",
            targetType: "login_identifier",
            targetId: identifier,
            context: { path: ctx.path },
          });
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many failed attempts. Try again later." });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!SIGN_IN_PATHS.has(ctx.path)) return;
        const returned = ctx.context.returned;
        if (isAPIError(returned) && returned.status !== "TOO_MANY_REQUESTS") {
          await platformDb().insert(platform.platformAuditEvent).values({
            action: "auth.login.failed",
            targetType: "login_identifier",
            // The identifier attempted (never the password), for lockout and investigation.
            targetId: signInIdentifier(ctx.body),
            ipAddress: ctx.request?.headers.get(e.AUTH_CLIENT_IP_HEADER)?.split(",")[0]?.trim() ?? null,
            context: { path: ctx.path, status: returned.status },
          });
        }
      }),
    },
  });
}

type Auth = ReturnType<typeof build>;
const g = globalThis as unknown as { __auth?: Auth };

/** Lazily built so `next build` doesn't need runtime secrets. */
export function getAuth(): Auth {
  g.__auth ??= build();
  return g.__auth;
}
