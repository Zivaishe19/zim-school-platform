/**
 * Same school, wrong person: parents, students and staff without a relationship must not
 * see records that aren't theirs. (Database-per-school does not protect against this.)
 */
import { describe, expect, it } from "vitest";
import { createStudent, getStudent, listStudents } from "@/modules/students/service";
import { ForbiddenError, resolveSchoolContext } from "@/server/tenancy/context";
import { asUser, fx } from "../helpers/fixtures";

const ctx = async (userId: string) => (await resolveSchoolContext(asUser(userId), fx.schools.slugA))!;

describe("parent", () => {
  it("lists only their linked children", async () => {
    const res = await listStudents(await ctx(fx.users.parentA));
    expect(res.rows.map((r) => r.id).sort()).toEqual([...fx.students.parentChildren].sort());
    expect(res.total).toBe(2);
  });

  it("cannot open another child's record in the same school", async () => {
    const c = await ctx(fx.users.parentA);
    expect(await getStudent(c, fx.students.parentChildren[0]!)).not.toBeNull();
    expect(await getStudent(c, fx.students.A[10]!)).toBeNull();
    expect(await getStudent(c, fx.students.studentSelf)).toBeNull();
  });

  it("cannot search their way to other students", async () => {
    const res = await listStudents(await ctx(fx.users.parentA), { q: "AFirst1" });
    expect(res.rows.every((r) => fx.students.parentChildren.includes(r.id))).toBe(true);
  });

  it("cannot create students", async () => {
    await expect(createStudent(await ctx(fx.users.parentA), { admissionNumber: "X/1", firstName: "a", lastName: "b" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("student", () => {
  it("sees only their own record", async () => {
    const c = await ctx(fx.users.studentUserA);
    const res = await listStudents(c);
    expect(res.rows.map((r) => r.id)).toEqual([fx.students.studentSelf]);
    expect(await getStudent(c, fx.students.A[0]!)).toBeNull();
  });
});

describe("teacher without classes or groups", () => {
  it("sees no students until they are assigned a class or teaching group", async () => {
    const c = await ctx(fx.users.teacherA2);
    expect((await listStudents(c)).total).toBe(0);
    expect(await getStudent(c, fx.students.A[0]!)).toBeNull();
  });
});

describe("headmaster", () => {
  it("can view all students but cannot create them", async () => {
    const c = await ctx(fx.users.headA);
    expect((await listStudents(c)).total).toBeGreaterThanOrEqual(30);
    await expect(createStudent(c, { admissionNumber: "X/2", firstName: "a", lastName: "b" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("school admin", () => {
  it("gets field errors for invalid or duplicate input", async () => {
    const c = await ctx(fx.users.adminA);
    const bad = await createStudent(c, { admissionNumber: "bad number!", firstName: "", lastName: "x" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.fieldErrors).sort()).toEqual(["admissionNumber", "firstName"]);
    const dupe = await createStudent(c, { admissionNumber: "A/001", firstName: "Dup", lastName: "Licate" });
    expect(dupe).toEqual({ ok: false, fieldErrors: { admissionNumber: ["This admission number is already in use"] } });
  });
});
