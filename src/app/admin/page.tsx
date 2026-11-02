import type { Metadata } from "next";
import Link from "next/link";
import { listSchoolsForOperators, requirePlatformAdmin } from "@/server/platform/admins";
import { Card, PageHeader } from "@/ui/primitives";
import { SignOutButton } from "@/ui/sign-out-button";

export const metadata: Metadata = { title: "Platform administration" };

export default async function AdminPage() {
  await requirePlatformAdmin();
  const schools = await listSchoolsForOperators();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="mb-4 flex justify-between">
        <Link href="/schools" className="text-sm text-brand-700 underline">
          ← Schools
        </Link>
        <SignOutButton />
      </div>
      <PageHeader
        title="Platform administration"
        description="School databases and their health. Platform operators cannot open school records from here."
      />
      <Card className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Schools on the platform</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">School</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
              <th scope="col" className="px-4 py-2 font-medium">Database</th>
              <th scope="col" className="px-4 py-2 font-medium">Schema</th>
              <th scope="col" className="px-4 py-2 font-medium">Last health check</th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.slug} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.slug}</div>
                </td>
                <td className="px-4 py-2">{s.status}</td>
                <td className="px-4 py-2 font-mono text-xs">{s.databaseName ?? "—"}</td>
                <td className="px-4 py-2">v{s.schemaVersion ?? 0}</td>
                <td className="px-4 py-2">
                  {s.healthStatus ?? "never"}
                  {s.lastHealthCheckAt ? (
                    <span className="block text-xs text-slate-500">{s.lastHealthCheckAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-4 text-sm text-slate-600">
        Provisioning a new school is done from the command line for now (<code>npm run school -- provision</code>). A provisioning
        form is planned for Milestone 2.
      </p>
    </main>
  );
}
