import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running app with the DEV seed (npm run db:seed).
 * Locally:  npm run dev  (in another terminal)  then  npm run test:e2e
 * CI starts the production build itself (see .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
