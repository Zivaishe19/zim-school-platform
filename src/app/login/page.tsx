import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/schools");
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-slate-600">Use your email address, or the username your school gave you.</p>
        <LoginForm />
        <p className="mt-6 text-xs text-slate-500">
          Forgotten your password? Ask your school&apos;s system administrator to reset it. Self-service recovery by email
          or phone is not available yet.
        </p>
      </div>
    </main>
  );
}
