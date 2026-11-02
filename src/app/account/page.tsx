import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/server/auth/session";
import { platformDb } from "@/server/db/platform/client";
import { user } from "@/server/db/platform/schema";
import { Alert, Card, PageHeader } from "@/ui/primitives";
import { Flash, Input, SubmitButton } from "@/ui/kit";
import { SignOutButton } from "@/ui/sign-out-button";
import { changePassword } from "./actions";
import { MfaSetup } from "./mfa-setup";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const sp = await searchParams;
  const me = await requireUser();
  const [u] = await platformDb().select({ must: user.mustChangePassword, mfa: user.twoFactorEnabled, email: user.email, username: user.username }).from(user).where(eq(user.id, me.id));
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <div className="mb-4 flex justify-between">
        <Link href="/schools" className="text-sm text-brand-700 underline">← My schools</Link>
        <SignOutButton />
      </div>
      <PageHeader title="My account" description={`${me.name} · ${u?.email.endsWith("@no-email.invalid") ? u.username : u?.email}`} />
      <Flash sp={sp} />
      {sp.required === "password" || u?.must ? <div className="mb-4"><Alert tone="warning">Your password was set by an administrator. Choose your own password to continue.</Alert></div> : null}
      {sp.required === "mfa" ? <div className="mb-4"><Alert tone="warning">Your role requires two-step verification. Set it up below to continue.</Alert></div> : null}

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold">Change password</h2>
        <form action={changePassword} className="flex flex-col gap-4">
          <Input label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
          <Input label="New password" name="newPassword" type="password" autoComplete="new-password" minLength={10} required hint="At least 10 characters. A short sentence is easy to remember and hard to guess." />
          <Input label="Repeat new password" name="confirm" type="password" autoComplete="new-password" required />
          <div><SubmitButton>Change password</SubmitButton></div>
        </form>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Two-step verification</h2>
        <p className="mb-3 text-sm text-slate-600">Uses an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis…). Required for headmasters, administrators and accounts staff.</p>
        <MfaSetup enabled={Boolean(u?.mfa)} />
      </Card>
    </main>
  );
}
