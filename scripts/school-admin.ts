/**
 * School operations CLI (runs with the provisioner credential; never part of the web app).
 *
 *   npm run school -- provision <slug> "<School name>"
 *   npm run school -- add-admin <slug> <email> "<Full name>"
 *   npm run school -- migrate-all
 *   npm run school -- health
 *   npm run school -- list
 */
import "./lib/load-env";
import { closePlatformDb, platformDb } from "@/server/db/platform/client";
import { school, schoolDatabase, user } from "@/server/db/platform/schema";
import { randomBytes } from "node:crypto";
import { createAccount } from "@/server/auth/accounts";
import { addSchoolMember } from "@/server/tenancy/membership";
import { closeAllSchoolDbs } from "@/server/tenancy/client-cache";
import { eq } from "drizzle-orm";
import { checkSchoolHealth, migrateAllSchools, provisionSchool } from "@/server/tenancy/provisioning";
import { migratePlatform } from "./lib/platform-migrate";

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "migrate-platform": {
      await migratePlatform();
      console.log("platform migrations applied");
      break;
    }
    case "provision": {
      const [slug, name] = args;
      if (!slug || !name) throw new Error('usage: provision <slug> "<School name>"');
      const r = await provisionSchool({ slug, name });
      console.log(`provisioned ${slug} -> ${r.databaseName} (${r.schoolId})`);
      break;
    }
    case "migrate-all": {
      const results = await migrateAllSchools();
      for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.slug} ${r.ok ? `v${r.version}` : r.error}`);
      if (results.some((r) => !r.ok)) process.exitCode = 1;
      break;
    }
    case "health": {
      const rows = await platformDb().select({ id: school.id, slug: school.slug }).from(school).where(eq(school.status, "active"));
      for (const s of rows) {
        const h = await checkSchoolHealth(s.id);
        console.log(`${h.status.padEnd(18)} ${s.slug} ${h.latencyMs}ms ${h.detail ?? ""}`);
        if (h.status !== "ok") process.exitCode = 1;
      }
      break;
    }
    case "add-admin": {
      // First administrator of a school. Prints a one-time temporary password; the admin must
      // change it at first sign-in and set up two-step verification.
      const [slug, email, ...nameParts] = args;
      const name = nameParts.join(" ").trim();
      if (!slug || !email || !name) throw new Error('usage: add-admin <slug> <email> "<Full name>"');
      const [s] = await platformDb().select().from(school).where(eq(school.slug, slug));
      if (!s || s.status !== "active") throw new Error("No active school with that slug");
      const temp = randomBytes(12).toString("base64url");
      const [existing] = await platformDb().select().from(user).where(eq(user.email, email.toLowerCase()));
      const userId = existing?.id ?? (await createAccount({ name, email, password: temp })).userId;
      if (!existing) await platformDb().update(user).set({ mustChangePassword: true }).where(eq(user.id, userId));
      const [first, ...rest] = name.split(" ");
      await addSchoolMember({ schoolId: s.id, userId, firstName: first!, lastName: rest.join(" ") || first!, roles: ["school_admin"] });
      console.log(existing ? `existing account ${email} is now School Administrator of ${slug}` : `created ${email} as School Administrator of ${slug}\ntemporary password (shown once): ${temp}`);
      await closeAllSchoolDbs();
      break;
    }
    case "list": {
      const rows = await platformDb()
        .select({ slug: school.slug, status: school.status, db: schoolDatabase.databaseName, v: schoolDatabase.schemaVersion, health: schoolDatabase.healthStatus })
        .from(school)
        .leftJoin(schoolDatabase, eq(schoolDatabase.schoolId, school.id));
      console.table(rows);
      break;
    }
    default:
      throw new Error("commands: migrate-platform | provision | add-admin | migrate-all | health | list");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closePlatformDb());
