import { defineConfig } from "drizzle-kit";

// Generates SQL migrations for platform_core. Apply with: npm run db:migrate:platform
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/platform/schema.ts",
  out: "./drizzle/platform",
  strict: true,
});
