import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { hasPermission, permissionsFor, ROLE_KEYS } from "@/server/rbac/roles";
import { assertSafeIdentifier, isValidSlug, schoolDatabaseName } from "@/server/tenancy/names";
import { decryptSecret, encryptSecret } from "@/server/tenancy/secrets";

describe("RBAC grants", () => {
  it.each([
    ["headmaster", "students.view_all", true],
    ["headmaster", "students.create", false],
    ["school_admin", "students.create", true],
    ["parent", "students.view_all", false],
    ["parent", "students.view_linked", true],
    ["student", "students.view_self", true],
    ["student", "students.view_linked", false],
    ["teacher", "students.view_all", false],
  ] as const)("%s has %s = %s", (role, perm, expected) => {
    expect(hasPermission([role], perm)).toBe(expected);
  });

  it("no role grants anything implicitly; empty roles have no permissions", () => {
    expect(permissionsFor([]).size).toBe(0);
    expect(ROLE_KEYS).not.toContain("super_admin");
  });
});

describe("secret envelope", () => {
  const key = randomBytes(32).toString("base64");
  it("round-trips", () => {
    expect(decryptSecret(encryptSecret("s3cret", key), key)).toBe("s3cret");
  });
  it("detects tampering and wrong keys", () => {
    const env = encryptSecret("s3cret", key);
    const parts = env.split(".");
    parts[3] = Buffer.from("other").toString("base64");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(env, randomBytes(32).toString("base64"))).toThrow();
  });
});

describe("names", () => {
  it("formats school database names", () => {
    expect(schoolDatabaseName("school_", 7)).toBe("school_0007");
  });
  it("validates slugs and identifiers", () => {
    expect(isValidSlug("kopje-heights")).toBe(true);
    for (const bad of ["Kopje", "-x", "x-", "a", "a b", "../x"]) expect(isValidSlug(bad)).toBe(false);
    expect(() => assertSafeIdentifier('x"; drop')).toThrow();
  });
});

describe("password hashing", () => {
  it("uses Argon2id and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword({ hash: h, password: "correct horse battery" })).toBe(true);
    expect(await verifyPassword({ hash: h, password: "wrong" })).toBe(false);
  });
});
