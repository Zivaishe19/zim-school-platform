import { config } from "dotenv";
import { afterAll } from "vitest";

config({ path: process.env.ENV_FILE ?? ".env.test", quiet: true, override: true });

afterAll(async () => {
  const { closeAllSchoolDbs } = await import("@/server/tenancy/client-cache");
  const { closePlatformDb } = await import("@/server/db/platform/client");
  await closeAllSchoolDbs();
  await closePlatformDb();
});
