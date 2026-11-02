import "server-only";
import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { createAccount, NO_EMAIL_DOMAIN } from "@/server/auth/accounts";
import { getAuth } from "@/server/auth/auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { platformDb } from "@/server/db/platform/client";
import { platformAdmin, platformAuditEvent, schoolMembership, user } from "@/server/db/platform/schema";
import { person, personRole, staff, student, studentGuardian } from "@/server/db/school/schema";
import { UserError } from "@/server/errors";
import { isRoleKey, ROLE_KEYS, STAFF_ROLES, type RoleKey } from "@/server/rbac/roles";
import { assertCan, can, type SchoolContext } from "@/server/tenancy/context";
import { addSchoolMember } from "@/server/tenancy/membership";
import { requireVisibleStudent } from "@/server/tenancy/scope";

export type PersonRow = {
  id: string;
  firstName: string;
  lastName: string;
  platformUserId: string | null;
  roles: RoleKey[];
  login: string | null;
};

/** People in this school with their roles and login name. Staff-facing directory. */
export async function listPeople(ctx: SchoolContext, opts: { role?: string; q?: string } = {}): Promise<PersonRow[]> {
  if (!can(ctx, "users.manage") && !can(ctx, "students.view_all") && !can(ctx, "messages.staff")) assertCan(ctx, "users.manage");
  const q = opts.q?.trim();
  const people = await ctx.db
    .select()
    .from(person)
    .where(q ? or(ilike(person.firstName, `%${q}%`), ilike(person.lastName, `%${q}%`)) : undefined)
    .orderBy(asc(person.lastName), asc(person.firstName))
    .limit(500);
  if (!people.length) return [];
  const roles = await ctx.db.select().from(personRole).where(inArray(personRole.personId, people.map((p) => p.id)));
  const userIds = people.map((p) => p.platformUserId).filter((x): x is string => Boolean(x));
  const logins = userIds.length
    ? await platformDb().select({ id: user.id, email: user.email, username: user.username }).from(user).where(inArray(user.id, userIds))
    : [];
  const rows = people.map((p) => {
    const l = logins.find((x) => x.id === p.platformUserId);
    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      platformUserId: p.platformUserId,
      roles: roles.filter((r) => r.personId === p.id).map((r) => r.roleKey).filter(isRoleKey),
      login: l ? (l.email.endsWith(`@${NO_EMAIL_DOMAIN}`) ? l.username : l.email) : null,
    };
  });
  return opts.role ? rows.filter((r) => r.roles.includes(opts.role as RoleKey)) : rows;
}

/** Staff members (for teacher pickers): anyone holding a staff role. */
export async function listStaff(ctx: SchoolContext) {
  const rows = await ctx.db
    .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, role: personRole.roleKey })
    .from(person)
    .innerJoin(personRole, eq(personRole.personId, person.id))
    .where(inArray(personRole.roleKey, [...STAFF_ROLES]))
    .orderBy(asc(person.lastName));
  const seen = new Map<string, { id: string; firstName: string; lastName: string; roles: string[] }>();
  for (const r of rows) {
    const e = seen.get(r.id) ?? { id: r.id, firstName: r.firstName, lastName: r.lastName, roles: [] };
    e.roles.push(r.role);
    seen.set(r.id, e);
  }
  return [...seen.values()];
}

const newPersonInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("").transform(() => undefined)),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._]{3,40}$/, "3-40 letters, digits, dot or underscore").optional().or(z.literal("").transform(() => undefined)),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH).optional().or(z.literal("").transform(() => undefined)),
  roles: z.array(z.enum(ROLE_KEYS)).min(1, "Choose at least one role"),
  employeeNumber: z.string().trim().max(40).optional(),
  jobTitle: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
});

/**
 * Creates a login (or reuses an existing one with the same email) and gives it roles in
 * THIS school. An existing account's password is never shown or changed here.
 */
export async function addPerson(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "users.manage");
  const v = newPersonInput.parse(raw);
  if (!v.email && !v.username) throw new UserError("Give an email address or a username.");

  let userId: string | null = null;
  if (v.email) {
    const [existing] = await platformDb().select({ id: user.id }).from(user).where(eq(user.email, v.email));
    userId = existing?.id ?? null;
  }
  if (!userId && v.username) {
    const [existing] = await platformDb().select({ id: user.id }).from(user).where(eq(user.username, v.username));
    if (existing) throw new UserError("That username is taken. Choose another.");
  }
  if (!userId) {
    if (!v.password) throw new UserError("Set a temporary password for the new account (at least 10 characters).");
    userId = (await createAccount({ name: `${v.firstName} ${v.lastName}`, email: v.email, username: v.username, password: v.password })).userId;
    await platformDb().update(user).set({ mustChangePassword: true }).where(eq(user.id, userId));
  }

  const { personId } = await addSchoolMember({
    schoolId: ctx.school.id,
    userId,
    firstName: v.firstName,
    lastName: v.lastName,
    roles: v.roles,
    actorUserId: ctx.user.id,
  });
  if (v.roles.some((r) => STAFF_ROLES.includes(r))) {
    await ctx.db
      .insert(staff)
      .values({ personId, employeeNumber: v.employeeNumber || null, jobTitle: v.jobTitle || null, phone: v.phone || null })
      .onConflictDoNothing();
  }
  return { personId, userId };
}

export async function setRoles(ctx: SchoolContext, personId: string, roles: string[]) {
  assertCan(ctx, "users.manage");
  const keys = z.array(z.enum(ROLE_KEYS)).parse(roles);
  if (personId === ctx.personId && !keys.some((r) => r === "school_admin" || r === "system_admin")) {
    throw new UserError("You cannot remove your own administrator role.");
  }
  await ctx.db.transaction(async (tx) => {
    await tx.delete(personRole).where(eq(personRole.personId, personId));
    if (keys.length) await tx.insert(personRole).values(keys.map((roleKey) => ({ personId, roleKey, grantedBy: ctx.user.id })));
    await recordSchoolAudit(tx, ctx, "person.roles.set", { type: "person", id: personId }, { roles: keys });
  });
}

/** Removes access to THIS school (membership suspended); the global account remains. */
export async function revokeAccess(ctx: SchoolContext, personId: string) {
  assertCan(ctx, "users.manage");
  if (personId === ctx.personId) throw new UserError("You cannot remove your own access.");
  const [p] = await ctx.db.select().from(person).where(eq(person.id, personId));
  if (!p?.platformUserId) throw new UserError("This person has no login.");
  await platformDb()
    .update(schoolMembership)
    .set({ status: "suspended" })
    .where(and(eq(schoolMembership.userId, p.platformUserId), eq(schoolMembership.schoolId, ctx.school.id)));
  await recordSchoolAudit(ctx.db, ctx, "person.access.revoked", { type: "person", id: personId });
}

/**
 * Administrator-assisted password reset. The admin sets a temporary password (never sees
 * the old one); the user must change it at next sign-in; all their sessions are revoked.
 * Allowed only for accounts that belong to THIS school alone and are not platform admins,
 * so one school can never take over an account used at another school.
 */
export async function resetPassword(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "users.manage");
  const v = z.object({ personId: z.string().uuid(), password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH) }).parse(raw);
  const [p] = await ctx.db.select().from(person).where(eq(person.id, v.personId));
  if (!p?.platformUserId) throw new UserError("This person has no login.");
  if (p.id === ctx.personId) throw new UserError("Use 'My account' to change your own password.");
  const uid = p.platformUserId;

  const memberships = await platformDb().select({ schoolId: schoolMembership.schoolId }).from(schoolMembership).where(eq(schoolMembership.userId, uid));
  if (memberships.some((m) => m.schoolId !== ctx.school.id)) {
    throw new UserError("This account is also used at another school. Ask platform support to reset it.");
  }
  const [admin] = await platformDb().select().from(platformAdmin).where(eq(platformAdmin.userId, uid));
  if (admin) throw new UserError("Platform administrator accounts cannot be reset by a school.");

  const auth = await getAuth().$context;
  await auth.internalAdapter.updatePassword(uid, await auth.password.hash(v.password));
  await auth.internalAdapter.deleteUserSessions(uid);
  await platformDb().update(user).set({ mustChangePassword: true, updatedAt: new Date() }).where(eq(user.id, uid));
  await platformDb().insert(platformAuditEvent).values({
    actorUserId: ctx.user.id,
    action: "auth.password.reset_by_admin",
    targetType: "user",
    targetId: uid,
    schoolId: ctx.school.id,
  });
  await recordSchoolAudit(ctx.db, ctx, "person.password.reset", { type: "person", id: p.id });
}

// ------------------------------------------------------------------ guardians and student logins
export async function guardiansOf(ctx: SchoolContext, studentId: string) {
  await requireVisibleStudent(ctx, studentId);
  return ctx.db
    .select({ personId: person.id, firstName: person.firstName, lastName: person.lastName, relationship: studentGuardian.relationship })
    .from(studentGuardian)
    .innerJoin(person, eq(person.id, studentGuardian.guardianPersonId))
    .where(eq(studentGuardian.studentId, studentId));
}

/** Link a parent (existing person, or a new parent account) to a student. */
export async function linkGuardian(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "users.manage");
  const v = z
    .object({
      studentId: z.string().uuid(),
      relationship: z.string().trim().min(2).max(40),
      existingPersonId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
      firstName: z.string().trim().max(80).optional(),
      lastName: z.string().trim().max(80).optional(),
      email: z.string().trim().optional(),
      username: z.string().trim().optional(),
      password: z.string().optional(),
    })
    .parse(raw);
  let guardianId = v.existingPersonId;
  if (!guardianId) {
    const created = await addPerson(ctx, { firstName: v.firstName, lastName: v.lastName, email: v.email, username: v.username, password: v.password, roles: ["parent"] });
    guardianId = created.personId;
  } else {
    await ctx.db.insert(personRole).values({ personId: guardianId, roleKey: "parent", grantedBy: ctx.user.id }).onConflictDoNothing();
  }
  await ctx.db.insert(studentGuardian).values({ studentId: v.studentId, guardianPersonId: guardianId, relationship: v.relationship }).onConflictDoNothing();
  await recordSchoolAudit(ctx.db, ctx, "student.guardian.linked", { type: "student", id: v.studentId }, { guardian: guardianId });
}

export async function unlinkGuardian(ctx: SchoolContext, studentId: string, guardianPersonId: string) {
  assertCan(ctx, "users.manage");
  await ctx.db.delete(studentGuardian).where(and(eq(studentGuardian.studentId, studentId), eq(studentGuardian.guardianPersonId, guardianPersonId)));
  await recordSchoolAudit(ctx.db, ctx, "student.guardian.unlinked", { type: "student", id: studentId }, { guardian: guardianPersonId });
}

/** Gives a student their own login (username, no email needed). */
export async function createStudentLogin(ctx: SchoolContext, raw: unknown) {
  assertCan(ctx, "users.manage");
  const v = z.object({ studentId: z.string().uuid(), username: z.string(), password: z.string() }).parse(raw);
  const [s] = await ctx.db.select().from(student).where(eq(student.id, v.studentId));
  if (!s) throw new UserError("Student not found.");
  if (s.personId) throw new UserError("This student already has a login.");
  const { personId } = await addPerson(ctx, { firstName: s.firstName, lastName: s.lastName, username: v.username, password: v.password, roles: ["student"] });
  await ctx.db.update(student).set({ personId, updatedAt: new Date() }).where(eq(student.id, s.id));
  await recordSchoolAudit(ctx.db, ctx, "student.login.created", { type: "student", id: s.id });
}

export async function personName(ctx: SchoolContext, personId: string | null | undefined) {
  if (!personId) return null;
  const [p] = await ctx.db.select({ f: person.firstName, l: person.lastName }).from(person).where(eq(person.id, personId));
  return p ? `${p.f} ${p.l}` : null;
}
