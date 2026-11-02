"use server";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/server/auth/auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { requireUser } from "@/server/auth/session";
import { platformDb } from "@/server/db/platform/client";
import { platformAuditEvent, user } from "@/server/db/platform/schema";

export async function changePassword(fd: FormData) {
  const me = await requireUser();
  const v = z
    .object({ currentPassword: z.string().min(1), newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH), confirm: z.string() })
    .safeParse(Object.fromEntries(fd));
  if (!v.success) redirect(`/account?error=${encodeURIComponent(`New password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`)}`);
  if (v.data.newPassword !== v.data.confirm) redirect(`/account?error=${encodeURIComponent("The two new passwords do not match.")}`);
  if (v.data.newPassword === v.data.currentPassword) redirect(`/account?error=${encodeURIComponent("Choose a password different from the current one.")}`);
  try {
    await getAuth().api.changePassword({ body: { currentPassword: v.data.currentPassword, newPassword: v.data.newPassword, revokeOtherSessions: true }, headers: await headers() });
  } catch {
    redirect(`/account?error=${encodeURIComponent("Your current password is not correct.")}`);
  }
  await platformDb().update(user).set({ mustChangePassword: false, updatedAt: new Date() }).where(eq(user.id, me.id));
  await platformDb().insert(platformAuditEvent).values({ actorUserId: me.id, action: "auth.password.changed", targetType: "user", targetId: me.id });
  redirect(`/account?ok=${encodeURIComponent("Password changed. Other devices were signed out.")}`);
}
