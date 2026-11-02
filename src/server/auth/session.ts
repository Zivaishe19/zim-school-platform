import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./auth";

export type CurrentUser = { id: string; name: string; email: string; username: string | null };

/** Reads and validates the session once per request. Returns a narrow user, never the raw session. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await getAuth().api.getSession({ headers: await headers() });
  if (!s?.user) return null;
  const u = s.user as typeof s.user & { username?: string | null };
  return { id: u.id, name: u.name, email: u.email, username: u.username ?? null };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
