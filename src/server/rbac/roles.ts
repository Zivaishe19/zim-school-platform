/**
 * School roles and permissions. Pure module: safe to unit test, no I/O.
 *
 * Roles are stored per person in each school's database (person_role).
 * Permissions are code, so changing what a role may do is a reviewed pull request.
 * Platform Super Admin is NOT a school role: it lives in platform_core and grants no
 * access to school records.
 *
 * Many permissions are further limited by RELATIONSHIPS in the services
 * (e.g. "attendance.take" only for the teacher's own classes/groups).
 */
export const ROLE_KEYS = [
  "headmaster",
  "school_admin",
  "system_admin",
  "teacher",
  "class_teacher",
  "accounts",
  "librarian",
  "parent",
  "student",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  headmaster: "Headmaster",
  school_admin: "School Administrator",
  system_admin: "System Administrator",
  teacher: "Teacher",
  class_teacher: "Class Teacher",
  accounts: "Accounts",
  librarian: "Library",
  parent: "Parent",
  student: "Student",
};

export const STAFF_ROLES: readonly RoleKey[] = ["headmaster", "school_admin", "system_admin", "teacher", "class_teacher", "accounts", "librarian"];
/** Roles that must use two-factor authentication (when REQUIRE_MFA_FOR_PRIVILEGED is on). */
export const PRIVILEGED_ROLES: readonly RoleKey[] = ["headmaster", "school_admin", "system_admin", "accounts"];

export const PERMISSIONS = [
  // students
  "students.view_all", // whole school directory
  "students.view_taught", // students in my teaching groups / my class
  "students.view_linked", // my children (guardian)
  "students.view_self", // my own record (student)
  "students.create",
  "students.import",
  // setup and people
  "settings.manage",
  "users.manage",
  "admissions.manage",
  // attendance
  "attendance.take",
  "attendance.view_all",
  "absence.review",
  // academic
  "assessments.manage_own",
  "marks.approve",
  "reports.prepare",
  "reports.approve",
  "reports.view_all",
  "progression.manage",
  // communication and activities
  "announcements.send",
  "announcements.send_own",
  "messages.staff",
  "events.manage",
  "activities.manage",
  // administration
  "fees.manage",
  "fees.view_all",
  "library.manage",
  "discipline.report",
  "discipline.decide",
  "discipline.view_all",
  "duties.manage",
  "staff_attendance.manage",
  "staff_attendance.view",
  "leave.request",
  "leave.review",
  "teacher_performance.view",
  "timetable.manage",
  "audit.view",
  // self-service portals
  "portal.guardian",
  "portal.student",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<RoleKey, readonly Permission[]> = {
  headmaster: [
    "students.view_all", "admissions.manage", "attendance.view_all", "absence.review", "marks.approve",
    "reports.view_all", "reports.approve", "progression.manage", "announcements.send", "messages.staff",
    "events.manage", "activities.manage", "fees.view_all", "discipline.view_all", "discipline.decide",
    "staff_attendance.view", "staff_attendance.manage", "leave.review", "teacher_performance.view", "audit.view",
  ],
  school_admin: [
    "settings.manage", "users.manage", "students.view_all", "students.create", "students.import", "admissions.manage",
    "attendance.view_all", "absence.review", "reports.view_all", "progression.manage", "announcements.send",
    "events.manage", "activities.manage", "timetable.manage", "staff_attendance.manage", "staff_attendance.view",
    "leave.review", "discipline.view_all", "audit.view",
  ],
  system_admin: ["users.manage", "students.view_all", "students.create", "students.import", "settings.manage"],
  teacher: [
    "students.view_taught", "attendance.take", "assessments.manage_own", "discipline.report", "leave.request",
    "messages.staff", "announcements.send_own",
  ],
  class_teacher: ["students.view_taught", "attendance.take", "reports.prepare", "duties.manage", "absence.review", "discipline.report", "messages.staff"],
  accounts: ["students.view_all", "fees.manage", "fees.view_all", "leave.request", "messages.staff"],
  librarian: ["students.view_all", "library.manage", "leave.request"],
  parent: ["students.view_linked", "portal.guardian"],
  student: ["students.view_self", "portal.student"],
};

export function isRoleKey(v: string): v is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(v);
}

export function permissionsFor(roles: readonly RoleKey[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of GRANTS[r]) out.add(p);
  return out;
}

export function hasPermission(roles: readonly RoleKey[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

export function isStaff(roles: readonly RoleKey[]): boolean {
  return roles.some((r) => STAFF_ROLES.includes(r));
}
