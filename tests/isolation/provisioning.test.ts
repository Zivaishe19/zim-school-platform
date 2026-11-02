import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { platformDb } from "@/server/db/platform/client";
import { platformAuditEvent, school, schoolDatabase, schoolMigrationRun } from "@/server/db/platform/schema";
import { REQUIRED_SCHOOL_SCHEMA_VERSION } from "@/server/tenancy/schema-version";
import { checkSchoolHealth, migrateAllSchools, provisionSchool } from "@/server/tenancy/provisioning";
import { fx } from "../helpers/fixtures";

describe("provisioning and migrations", () => {
  it("provisioned schools have their own database, role and current schema", async () => {
    const rows = await platformDb().select().from(schoolDatabase);
    const ours = rows.filter((r) => [fx.schools.A, fx.schools.B].includes(r.schoolId));
    expect(new Set(ours.map((r) => r.databaseName)).size).toBe(2);
    expect(new Set(ours.map((r) => r.roleName)).size).toBe(2);
    for (const r of ours) {
      expect(r.schemaVersion).toBe(REQUIRED_SCHOOL_SCHEMA_VERSION);
      expect(r.encryptedPassword.startsWith("v1.")).toBe(true);
    }
  });

  it("re-running migrations is idempotent and recorded per school", async () => {
    const results = await migrateAllSchools();
    expect(results.filter((r) => [fx.schools.slugA, fx.schools.slugB].includes(r.slug)).every((r) => r.ok)).toBe(true);
    const runs = await platformDb().select().from(schoolMigrationRun).where(eq(schoolMigrationRun.schoolId, fx.schools.A));
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((r) => r.status === "succeeded")).toBe(true);
  });

  it("health check connects as the school's own role", async () => {
    expect((await checkSchoolHealth(fx.schools.A)).status).toBe("ok");
    expect((await checkSchoolHealth(fx.schools.B)).status).toBe("ok");
  });

  it("refuses duplicate slugs and invalid input", async () => {
    await expect(provisionSchool({ slug: fx.schools.slugA, name: "Again" })).rejects.toThrow(/already exists/);
    await expect(provisionSchool({ slug: "Bad Slug", name: "Bad" })).rejects.toThrow(/Invalid slug/);
  });

  it("audits provisioning on the platform", async () => {
    const events = await platformDb().select().from(platformAuditEvent).where(eq(platformAuditEvent.schoolId, fx.schools.B));
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["school.provision.started", "school.provision.completed"]));
  });

  it("schools are active after provisioning", async () => {
    const rows = await platformDb().select({ s: school.status }).from(school).where(eq(school.id, fx.schools.A));
    expect(rows[0]!.s).toBe("active");
  });
});
