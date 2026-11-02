import { defineConfig } from "drizzle-kit";

// Generates SQL migrations shared by ALL school databases.
// Apply to every school with: npm run db:migrate:schools
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/school/schema.ts",
  out: "./drizzle/school",
  strict: true,
});
