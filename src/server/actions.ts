import "server-only";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { UserError } from "./errors";
import { ForbiddenError, type SchoolContext } from "./tenancy/context";
import { requireSchoolContext } from "./tenancy/require-context";

export type FormValues = Record<string, string | string[]>;

/** FormData -> plain object; repeated keys (checkbox lists) become arrays. Skips files and _-prefixed keys. */
export function formValues(fd: FormData): FormValues {
  const out: FormValues = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string" || k.startsWith("_") || k.startsWith("$ACTION")) continue;
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

export function list(v: string | string[] | undefined): string[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Message safe to show for any error thrown by a service. */
export function userMessage(e: unknown): string {
  if (e instanceof UserError) return e.message;
  if (e instanceof ForbiddenError) return "You do not have permission to do that.";
  if (e instanceof ZodError) {
    const i = e.issues[0];
    const field = i?.path.join(".");
    return field ? `${field}: ${i?.message}` : (i?.message ?? "Invalid input");
  }
  console.error("[action] unexpected error", e instanceof Error ? e.message : e);
  return "Something went wrong. Please try again.";
}

function withParam(url: string, key: "ok" | "error", msg: string): string {
  const u = new URL(url, "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("error");
  u.searchParams.set(key, msg.slice(0, 300));
  return `${u.pathname}${u.search}`;
}

/**
 * Standard server-action wrapper for school pages (works without JavaScript):
 * re-verifies membership, runs the service, then redirects back with ?ok= or ?error=.
 * `_back` must be a path inside this school, otherwise the school home is used.
 */
export async function schoolAction(
  slug: string,
  fd: FormData,
  run: (ctx: SchoolContext, values: FormValues) => Promise<string | { ok: string; to?: string } | void>,
): Promise<never> {
  const ctx = await requireSchoolContext(slug);
  const base = `/s/${ctx.school.slug}`;
  const rawBack = String(fd.get("_back") ?? "");
  const back = rawBack.startsWith(`${base}/`) || rawBack === base ? rawBack : base;
  let target: string;
  try {
    const r = await run(ctx, formValues(fd));
    const okMsg = typeof r === "string" ? r : (r?.ok ?? "Saved.");
    const to = typeof r === "object" && r?.to?.startsWith(base) ? r.to : back;
    target = withParam(to, "ok", okMsg);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    target = withParam(back, "error", userMessage(e));
  }
  redirect(target);
}
