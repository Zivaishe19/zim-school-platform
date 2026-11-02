import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/server/auth/session";
import { resolveSchoolContext, type SchoolContext } from "./context";

/**
 * The ONE entry point for pages, server actions and route handlers.
 * No session -> /login. No membership -> 404 (not 403, so slugs can't be probed).
 */
export const requireSchoolContext = cache(async (slug: string): Promise<SchoolContext> => {
  const user = await requireUser();
  const ctx = await resolveSchoolContext(user, slug);
  if (!ctx) notFound();
  return ctx;
});
