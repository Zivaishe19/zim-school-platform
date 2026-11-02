import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { platformDb } from "@/server/db/platform/client";
import { platformAuditEvent } from "@/server/db/platform/schema";
import { fx } from "../helpers/fixtures";

// The account is locked after AUTH_ACCOUNT_LOCKOUT_FAILURES (default 10) failures in 15
// minutes, regardless of IP, and even the CORRECT password is then refused.
describe("per-account brute-force lockout", () => {
  it("locks an account after repeated failures and audits it", async () => {
    const auth = getAuth();
    const email = "admin-b@test.invalid";
    const attempt = (password: string) =>
      auth.api.signInEmail({ body: { email, password }, headers: new Headers({ "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` }) });

    for (let i = 0; i < 10; i++) await expect(attempt("wrong-password-123")).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await expect(attempt(fx.password)).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });

    const failed = await platformDb()
      .select()
      .from(platformAuditEvent)
      .where(and(eq(platformAuditEvent.action, "auth.login.failed"), eq(platformAuditEvent.targetId, email)));
    expect(failed).toHaveLength(10);
    const locked = await platformDb()
      .select()
      .from(platformAuditEvent)
      .where(and(eq(platformAuditEvent.action, "auth.login.locked_out"), eq(platformAuditEvent.targetId, email)));
    expect(locked).toHaveLength(1);
  });

  it("does not affect other accounts", async () => {
    const res = await getAuth().api.signInEmail({ body: { email: "head-a@test.invalid", password: fx.password }, headers: new Headers() });
    expect(res.user.email).toBe("head-a@test.invalid");
  });
});
