"use client";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin: talks to /api/auth on this deployment (rate limited server-side).
export const authClient = createAuthClient({ plugins: [usernameClient(), twoFactorClient()] });
