import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { submitOnlineApplication } from "@/modules/admissions/service";
import { platformDb } from "@/server/db/platform/client";
import { school } from "@/server/db/platform/schema";
import { userMessage, formValues } from "@/server/actions";
import { getSchoolDb } from "@/server/tenancy/client-cache";
import { isValidSlug } from "@/server/tenancy/names";
import { Alert, Card } from "@/ui/primitives";
import { ApplicationFields } from "@/ui/application-fields";

export const metadata: Metadata = { title: "Apply for a place" };

async function activeSchool(slug: string) {
  if (!isValidSlug(slug)) return null;
  const [s] = await platformDb().select({ id: school.id, name: school.name, slug: school.slug }).from(school).where(and(eq(school.slug, slug), eq(school.status, "active")));
  return s ?? null;
}

/** PUBLIC page (no login). Writes only a new "submitted" application into that school. */
export default async function ApplyPage({ params, searchParams }: PageProps<"/apply/[schoolSlug]">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const s = await activeSchool(schoolSlug);
  if (!s) notFound();

  async function submit(fd: FormData) {
    "use server";
    const target = await activeSchool(schoolSlug);
    if (!target) notFound();
    const ip = (await headers()).get(process.env.AUTH_CLIENT_IP_HEADER ?? "x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    let ref: string;
    try {
      ref = (await submitOnlineApplication(await getSchoolDb(target.id), target.id, formValues(fd), ip)).reference;
    } catch (e) {
      redirect(`/apply/${target.slug}?error=${encodeURIComponent(userMessage(e))}`);
    }
    redirect(`/apply/${target.slug}?done=${encodeURIComponent(ref)}`);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold">Apply to {s.name}</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">Form 1, Form 4, Lower Six or a mid-year transfer. The school will contact you on the phone number you give. Bring original documents when invited.</p>
      {typeof sp.done === "string" ? (
        <Alert tone="info">Thank you. Your application reference is <strong>{sp.done}</strong>. Keep it for any enquiry.</Alert>
      ) : (
        <Card>
          {typeof sp.error === "string" ? <div className="mb-4"><Alert tone="error">{sp.error}</Alert></div> : null}
          <ApplicationFields action={submit} back={`/apply/${s.slug}`} />
          <p className="mt-4 text-xs text-slate-500">The school uses this information only to process the application, in line with the Cyber and Data Protection Act.</p>
        </Card>
      )}
    </main>
  );
}
