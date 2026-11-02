"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field } from "@/ui/primitives";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needCode, setNeedCode] = useState(false);

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setPending(true);
    const res = code.length > 6 ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (res.error) return setError("That code is not correct.");
    router.replace("/schools");
    router.refresh();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    const identifier = String(data.get("identifier") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (!identifier || !password) {
      setError("Enter your email or username and your password.");
      return;
    }
    setPending(true);
    const res = identifier.includes("@")
      ? await authClient.signIn.email({ email: identifier, password })
      : await authClient.signIn.username({ username: identifier.toLowerCase(), password });
    setPending(false);
    if (!res.error && (res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      setNeedCode(true);
      return;
    }
    if (res.error) {
      // Same message for unknown user and wrong password (no account enumeration).
      setError(
        res.error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "That email/username and password combination is not correct.",
      );
      return;
    }
    router.replace("/schools");
    router.refresh();
  }

  if (needCode) {
    return (
      <form onSubmit={onCode} className="flex flex-col gap-4" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field label="6-digit code from your authenticator app (or a backup code)" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Verify"}</Button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label="Email or username" name="identifier" autoComplete="username" autoCapitalize="none" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
