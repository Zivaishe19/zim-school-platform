import "server-only";
import path from "node:path";
import journal from "../../../drizzle/school/meta/_journal.json";

/**
 * The school schema version this build of the app expects = number of school migrations
 * shipped with it. A school whose database is behind is shown a maintenance page instead
 * of being queried with a schema it doesn't have (see client-cache.ts).
 */
export const REQUIRED_SCHOOL_SCHEMA_VERSION: number = journal.entries.length;

export const SCHOOL_MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle", "school");
export const PLATFORM_MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle", "platform");
