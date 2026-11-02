import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/tenancy/context";
import { requireSchoolContext } from "@/server/tenancy/require-context";
import { PageHeader } from "@/ui/primitives";
import { createStudentAction } from "./actions";
import { NewStudentForm } from "./form";

export const metadata: Metadata = { title: "Add student" };

export default async function NewStudentPage({ params }: PageProps<"/s/[schoolSlug]/students/new">) {
  const { schoolSlug } = await params;
  const ctx = await requireSchoolContext(schoolSlug);
  if (!can(ctx, "students.create")) notFound();

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/s/${ctx.school.slug}/students`} className="text-brand-700 underline">
          ← Students
        </Link>
      </p>
      <PageHeader title="Add student" description="Creates a registered student record. Bulk CSV import arrives in Milestone 2." />
      <NewStudentForm action={createStudentAction.bind(null, ctx.school.slug)} />
    </>
  );
}
