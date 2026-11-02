import { execFileSync } from "node:child_process";

/**
 * Rebuilds the test world before the run: drop test DBs -> create platform DB ->
 * provision two schools -> create users. Uses .env.test (platform_core_test, test_school_*).
 */
export default function setup() {
  const env: NodeJS.ProcessEnv = { ...process.env, ENV_FILE: process.env.ENV_FILE ?? ".env.test", NODE_ENV: "test" };
  const run = (script: string) =>
    execFileSync("npx", ["tsx", "--conditions=react-server", script], { stdio: "inherit", env });
  run("scripts/db-reset.ts");
  run("scripts/db-setup.ts");
  run("tests/helpers/create-fixtures.ts");
}
