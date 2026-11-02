/**
 * Loads .env (or the file named by ENV_FILE, e.g. .env.test) for CLI scripts.
 * Scripts must run with:  tsx --conditions=react-server  (see package.json) so that
 * "server-only" modules can be imported outside Next.js.
 */
import { config } from "dotenv";

config({ path: process.env.ENV_FILE ?? ".env", quiet: true });
