"use server";

import { redirect } from "next/navigation";
import { createStudent } from "@/modules/students/service";
import { can } from "@/server/tenancy/context";
import { requireSchoolContext } from "@/server/tenancy/require-context";

export type CreateStudentState = { fieldErrors?: Record<string, string[]>; formError?: string };

/**
 * Server actions are public POST endpoints: the slug is bound from the page, but
 * membership and permission are re-verified here on every call.
 */
export async function createStudentAction(schoolSlug: string, _prev: CreateStudentState, formData: FormData): Promise<CreateStudentState> {
  const ctx = await requireSchoolContext(schoolSlug);
  if (!can(ctx, "students.create")) return { formError: "You do not have permission to add students." };

  const result = await createStudent(ctx, {
    admissionNumber: String(formData.get("admissionNumber") ?? ""),
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    dateOfBirth: String(formData.get("dateOfBirth") ?? ""),
  });
  if (!result.ok) return { fieldErrors: result.fieldErrors };
  redirect(`/s/${ctx.school.slug}/students/${result.id}`);
}
