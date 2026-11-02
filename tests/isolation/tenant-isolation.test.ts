/**
 * CROSS-SCHOOL ISOLATION SUITE
 * Proves, against two independently provisioned school databases, that one school's users
 * cannot reach another school's records at any layer: Postgres roles, tenant resolution,
 * the client cache, and the module services (IDOR).
 * Every new module must add its own cases here (see TESTING.md).
 */
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createStudent, getStudent, listStudents } from "@/modules/students/service";
import { platformDb } from "@/server/db/platform/client";
import { school, schoolDatabase, schoolMembership } from "@/server/db/platform/schema";
import { auditEvent, student } from "@/server/db/school/schema";
import { env } from "@/server/env";
import { evictSchoolDb, getSchoolDb, SchoolUnavailableError } from "@/server/tenancy/client-cache";
import { resolveSchoolContext, type SchoolContext } from "@/server/tenancy/context";
import { decryptSecret } from "@/server/tenancy/secrets";
import { asUser, fx } from "../helpers/fixtures";

async function ctxFor(userId: string, slug: string): Promise<SchoolContext> {
  const c = await resolveSchoolContext(asUser(userId), slug);
  if (!c) throw new Error(`expected a context for ${userId} in ${slug}`);
  return c;
}

async function credentials(schoolId: string) {
  const [row] = await platformDb().select().from(schoolDatabase).where(eq(schoolDatabase.schoolId, schoolId));
  return { ...row!, password: decryptSecret(row!.encryptedPassword, env().SCHOOL_DB_ENCRYPTION_KEY) };
}

type Creds = Awaited<ReturnType<typeof credentials>>;

/** Writes routing rows: each [school, source] pair points `school` at `source`'s database. */
async function setRouting(pairs: [Creds, Creds][]) {
  await platformDb().transaction(async (tx) => {
    // database_name/role_name are unique: park every row on a temporary name first.
    for (const [target] of pairs) {
      await tx
        .update(schoolDatabase)
        .set({ databaseName: `tmp_${target.schoolId}`, roleName: `tmp_${target.schoolId}` })
        .where(eq(schoolDatabase.schoolId, target.schoolId));
    }
    for (const [target, source] of pairs) {
      await tx
        .update(schoolDatabase)
        .set({ databaseName: source.databaseName, roleName: source.roleName, encryptedPassword: source.encryptedPassword })
        .where(eq(schoolDatabase.schoolId, target.schoolId));
    }
  });
}

describe("Postgres layer", () => {
  it("school A's role cannot connect to school B's database", async () => {
    const a = await credentials(fx.schools.A);
    const b = await credentials(fx.schools.B);
    const c = new Client({ host: a.host, port: a.port, user: a.roleName, password: a.password, database: b.databaseName });
    await expect(c.connect()).rejects.toThrow(/permission denied/i);
    await c.end().catch(() => undefined);
  });

  it("school A's role cannot connect to the platform database", async () => {
    const a = await credentials(fx.schools.A);
    const platformDbName = new URL(process.env.PLATFORM_DATABASE_URL!).pathname.slice(1);
    const c = new Client({ host: a.host, port: a.port, user: a.roleName, password: a.password, database: platformDbName });
    await expect(c.connect()).rejects.toThrow(/permission denied/i);
    await c.end().catch(() => undefined);
  });

  it("app role cannot alter the audit log or the schema", async () => {
    const a = await credentials(fx.schools.A);
    const c = new Client({ host: a.host, port: a.port, user: a.roleName, password: a.password, database: a.databaseName });
    await c.connect();
    try {
      await expect(c.query("update audit_event set action = 'tampered'")).rejects.toThrow(/permission denied/i);
      await expect(c.query("delete from audit_event")).rejects.toThrow(/permission denied/i);
      await expect(c.query("update school_identity set school_id = gen_random_uuid()")).rejects.toThrow(/permission denied/i);
      await expect(c.query("create table evil (id int)")).rejects.toThrow(/permission denied/i);
    } finally {
      await c.end();
    }
  });
});

describe("tenant resolution", () => {
  it("rejects a school the user is not a member of", async () => {
    expect(await resolveSchoolContext(asUser(fx.users.headA), fx.schools.slugB)).toBeNull();
    expect(await resolveSchoolContext(asUser(fx.users.adminB), fx.schools.slugA)).toBeNull();
  });

  it("gives a multi-school user a separate database per school", async () => {
    const a = await ctxFor(fx.users.both, fx.schools.slugA);
    const b = await ctxFor(fx.users.both, fx.schools.slugB);
    expect(a.school.id).toBe(fx.schools.A);
    expect(b.school.id).toBe(fx.schools.B);
    expect(a.db).not.toBe(b.db);
  });

  it("platform super admins get no school access by default", async () => {
    expect(await resolveSchoolContext(asUser(fx.users.operator), fx.schools.slugA)).toBeNull();
  });

  it.each(["../bravo-college", "BRAVO-COLLEGE", "bravo-college;drop", "", "a", "%2e%2e"])("rejects malformed slug %j", async (slug) => {
    expect(await resolveSchoolContext(asUser(fx.users.both), slug)).toBeNull();
  });

  it("rejects suspended memberships and suspended schools", async () => {
    const db = platformDb();
    await db.update(schoolMembership).set({ status: "suspended" }).where(eq(schoolMembership.userId, fx.users.headA));
    expect(await resolveSchoolContext(asUser(fx.users.headA), fx.schools.slugA)).toBeNull();
    await db.update(schoolMembership).set({ status: "active" }).where(eq(schoolMembership.userId, fx.users.headA));

    await db.update(school).set({ status: "suspended" }).where(eq(school.id, fx.schools.A));
    expect(await resolveSchoolContext(asUser(fx.users.headA), fx.schools.slugA)).toBeNull();
    await db.update(school).set({ status: "active" }).where(eq(school.id, fx.schools.A));
    expect(await resolveSchoolContext(asUser(fx.users.headA), fx.schools.slugA)).not.toBeNull();
  });
});

describe("client cache safety", () => {
  afterEach(() => evictSchoolDb(fx.schools.A));

  it("refuses a connection that reaches another school's database (identity check)", async () => {
    const a = await credentials(fx.schools.A);
    const b = await credentials(fx.schools.B);
    // Simulate a mis-wired routing table: swap A's and B's database rows.
    await setRouting([[a, b], [b, a]]);
    evictSchoolDb(fx.schools.A);
    evictSchoolDb(fx.schools.B);
    try {
      await expect(getSchoolDb(fx.schools.A)).rejects.toMatchObject({ reason: "identity_mismatch" });
      await expect(getSchoolDb(fx.schools.B)).rejects.toMatchObject({ reason: "identity_mismatch" });
    } finally {
      await setRouting([[a, a], [b, b]]);
      evictSchoolDb(fx.schools.B);
    }
    expect(await getSchoolDb(fx.schools.A)).toBeDefined();
  });

  it("refuses to serve a school whose schema is behind this build", async () => {
    const db = platformDb();
    const [row] = await db.select({ v: schoolDatabase.schemaVersion }).from(schoolDatabase).where(eq(schoolDatabase.schoolId, fx.schools.A));
    await db.update(schoolDatabase).set({ schemaVersion: 0 }).where(eq(schoolDatabase.schoolId, fx.schools.A));
    evictSchoolDb(fx.schools.A);
    try {
      const err = await getSchoolDb(fx.schools.A).catch((e) => e);
      expect(err).toBeInstanceOf(SchoolUnavailableError);
      expect(err.reason).toBe("schema_behind");
    } finally {
      await db.update(schoolDatabase).set({ schemaVersion: row!.v }).where(eq(schoolDatabase.schoolId, fx.schools.A));
    }
  });
});

describe("student records across schools (IDOR)", () => {
  it("a school's listing contains only its own students", async () => {
    const a = await ctxFor(fx.users.headA, fx.schools.slugA);
    const all = await listStudents(a, { page: 1 });
    expect(all.total).toBeGreaterThanOrEqual(30);
    expect(all.rows.every((r) => r.admissionNumber.startsWith("A/"))).toBe(true);
    const searchB = await listStudents(a, { q: "B/0" });
    expect(searchB.total).toBe(0);
  });

  it("a student id from school B is not found through school A, even for a member of both", async () => {
    const a = await ctxFor(fx.users.both, fx.schools.slugA);
    for (const id of fx.students.B.slice(0, 5)) expect(await getStudent(a, id)).toBeNull();
    const b = await ctxFor(fx.users.both, fx.schools.slugB);
    expect(await getStudent(b, fx.students.B[0]!)).not.toBeNull();
  });

  it("writes land only in the acting school's database, with an audit entry there", async () => {
    const a = await ctxFor(fx.users.adminA, fx.schools.slugA);
    const res = await createStudent(a, { admissionNumber: "A/NEW/1", firstName: "Isolated", lastName: "Write" });
    expect(res.ok).toBe(true);
    const id = res.ok ? res.id : "";

    const dbB = await getSchoolDb(fx.schools.B);
    expect(await dbB.select().from(student).where(eq(student.admissionNumber, "A/NEW/1"))).toHaveLength(0);
    expect(await dbB.select().from(auditEvent).where(eq(auditEvent.targetId, id))).toHaveLength(0);

    const dbA = await getSchoolDb(fx.schools.A);
    const audits = await dbA.select().from(auditEvent).where(eq(auditEvent.targetId, id));
    expect(audits.map((x) => x.action)).toEqual(["student.created"]);
    expect(audits[0]!.actorUserId).toBe(fx.users.adminA);
  });

  it("rejects malformed ids without touching the database", async () => {
    const a = await ctxFor(fx.users.headA, fx.schools.slugA);
    for (const bad of ["1", "' or 1=1 --", "../../etc/passwd", ""]) expect(await getStudent(a, bad)).toBeNull();
  });
});
