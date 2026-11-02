import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { isPlatformAdmin } from "@/server/platform/admins";
import { listMySchools } from "@/server/tenancy/context";
import { Card } from "@/ui/primitives";
import { SignOutButton } from "@/ui/sign-out-button";

export const metadata: Metadata = { title: "Choose a school" };

export default async function SchoolsPage() {
  const user = await requireUser();
  const [schools, operator] = await Promise.all([listMySchools(user.id), isPlatformAdmin(user.id)]);

  // One school and not an operator: skip the picker.
  if (schools.length === 1 && !operator) redirect(`/s/${schools[0]!.slug}`);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Choose a school</h1>
          <p className="text-sm text-slate-600">Signed in as {user.name}</p>
        </div>
        <SignOutButton />
      </div>

      {schools.length === 0 && !operator ? (
        <Card>
          <p className="text-sm text-slate-700">
            Your account is not linked to any school yet. Ask your school&apos;s administrator to add you.
          </p>
        </Card>
      ) : null}

      {schools.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {schools.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/s/${s.slug}`}
                className="block rounded-lg border border-slate-200 bg-white px-4 py-3 font-medium hover:border-brand-600 hover:bg-brand-50"
              >
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {operator ? (
        <p className="mt-6 text-sm">
          <Link href="/admin" className="font-medium text-brand-700 underline">
            Platform administration
          </Link>
        </p>
      ) : null}
    </main>
  );
}
