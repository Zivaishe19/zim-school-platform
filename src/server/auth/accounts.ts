import "server-only";
import { z } from "zod";
import { getAuth } from "./auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";

/**
 * Server-side account creation (self sign-up is disabled). Used by onboarding flows,
 * seeding and tests. Students without email get a placeholder address on a reserved
 * domain and sign in with their username.
 */
export const newAccountInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._]{3,40}$/, "3-40 characters: letters, digits, dot, underscore")
    .optional(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export type NewAccountInput = z.input<typeof newAccountInput>;

export const NO_EMAIL_DOMAIN = "no-email.invalid";

export async function createAccount(raw: NewAccountInput): Promise<{ userId: string }> {
  const input = newAccountInput.parse(raw);
  if (!input.email && !input.username) throw new Error("An email or a username is required");
  const ctx = await getAuth().$context;
  const email = input.email ?? `${input.username}@${NO_EMAIL_DOMAIN}`;

  if (await ctx.internalAdapter.findUserByEmail(email)) throw new Error("An account with this email already exists");

  const created = await ctx.internalAdapter.createUser({
    name: input.name,
    email,
    emailVerified: false,
    ...(input.username ? { username: input.username, displayUsername: input.username } : {}),
  }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: await ctx.password.hash(input.password),
  });
  return { userId: created.id };
}
