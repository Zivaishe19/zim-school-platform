"use client";

import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field } from "@/ui/primitives";

export function MfaSetup({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "scan">("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(form: FormData) {
    setError(null);
    setBusy(true);
    const res = await authClient.twoFactor.enable({ password: String(form.get("password") ?? "") });
    setBusy(false);
    if (res.error || !res.data || res.data.method !== "totp") return setError("Password not correct.");
    setQr(await QRCode.toDataURL(res.data.totpURI, { margin: 1, width: 220 }));
    setSecret(new URL(res.data.totpURI).searchParams.get("secret"));
    setCodes(res.data.backupCodes);
    setStep("scan");
  }

  async function verify(form: FormData) {
    setError(null);
    setBusy(true);
    const res = await authClient.twoFactor.verifyTotp({ code: String(form.get("code") ?? "").replace(/\s/g, "") });
    setBusy(false);
    if (res.error) return setError("That code is not correct. Check the time on your phone and try again.");
    router.push("/schools");
    router.refresh();
  }

  async function disable(form: FormData) {
    setError(null);
    const res = await authClient.twoFactor.disable({ password: String(form.get("password") ?? "") });
    if (res.error) return setError("Password not correct.");
    router.refresh();
  }

  if (enabled && step === "idle") {
    return (
      <form action={disable} className="flex flex-col gap-3">
        <Alert tone="info">Two-step verification is ON.</Alert>
        <Field label="Password (to turn it off)" name="password" type="password" autoComplete="current-password" />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div><Button type="submit" variant="secondary">Turn off</Button></div>
      </form>
    );
  }
  if (step === "scan") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">1. Scan this code with your authenticator app (or type the key below).</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL QR code, nothing to optimise */}
        {qr ? <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="rounded border border-slate-200" /> : null}
        {secret ? <p className="font-mono text-sm break-all">{secret}</p> : null}
        <p className="text-sm">2. Write down these backup codes and keep them safe. Each works once if you lose your phone:</p>
        <ul className="grid grid-cols-2 gap-1 rounded bg-slate-50 p-3 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <form action={verify} className="flex flex-col gap-3">
          <Field label="3. Enter the 6-digit code from the app" name="code" inputMode="numeric" autoComplete="one-time-code" />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div><Button type="submit" disabled={busy}>Confirm and turn on</Button></div>
        </form>
      </div>
    );
  }
  return (
    <form action={start} className="flex flex-col gap-3">
      <Field label="Your password" name="password" type="password" autoComplete="current-password" />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div><Button type="submit" disabled={busy}>Set up two-step verification</Button></div>
    </form>
  );
}
