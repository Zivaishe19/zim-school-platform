import "server-only";
import { notFound } from "next/navigation";
import { requireSchoolContext } from "@/server/tenancy/require-context";

type Props = { params: Promise<{ schoolSlug: string } & Record<string, string>>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** Common page setup: verified school context, search params, base path. */
export async function load(props: Props) {
  const params = await props.params;
  const sp = (await props.searchParams) ?? {};
  const ctx = await requireSchoolContext(params.schoolSlug);
  const base = `/s/${ctx.school.slug}`;
  return { ctx, sp, params, base, slug: ctx.school.slug };
}

export function guard(cond: unknown): asserts cond {
  if (!cond) notFound();
}

export function str(v: string | string[] | undefined, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
