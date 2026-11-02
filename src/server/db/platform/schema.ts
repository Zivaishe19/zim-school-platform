/**
 * platform_core schema: identities, schools, routing, provisioning and platform audit.
 * Student/academic data NEVER lives here; it lives in each school's own database.
 */
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// ---------------------------------------------------------------------------
// Better Auth tables (names fixed by Better Auth's model names: user, session,
// account, verification, twoFactor, rateLimit). SQL tables are prefixed auth_.
// ---------------------------------------------------------------------------
export const user = pgTable("auth_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  /** Set by an administrator reset: the user must choose a new password at next sign-in. */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "auth_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "auth_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "auth_verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

export const twoFactor = pgTable("auth_two_factor", {
  id: uuid("id").primaryKey().defaultRandom(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: ts("locked_until"),
});

export const rateLimit = pgTable("auth_rate_limit", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ---------------------------------------------------------------------------
// Schools and routing
// ---------------------------------------------------------------------------
export const schoolStatus = pgEnum("school_status", [
  "provisioning",
  "provisioning_failed",
  "active",
  "suspended",
  "archived",
]);

export const school = pgTable("school", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** URL-safe, public. Only a *hint* in requests; membership is always verified. */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  status: schoolStatus("status").notNull().default("provisioning"),
  statusDetail: text("status_detail"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Where a school's database lives. Read ONLY by src/server/tenancy.
 * Moving a school to another cluster = restore its DB there + update host/port.
 */
export const schoolDatabase = pgTable("school_database", {
  schoolId: uuid("school_id")
    .primaryKey()
    .references(() => school.id, { onDelete: "restrict" }),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  databaseName: text("database_name").notNull().unique(),
  roleName: text("role_name").notNull().unique(),
  /** AES-256-GCM ciphertext (see tenancy/secrets.ts). Never returned to clients. */
  encryptedPassword: text("encrypted_password").notNull(),
  /** Number of school migrations applied (drizzle journal length). */
  schemaVersion: integer("schema_version").notNull().default(0),
  lastHealthCheckAt: ts("last_health_check_at"),
  healthStatus: text("health_status"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const membershipStatus = pgEnum("membership_status", ["active", "suspended"]);

export const schoolMembership = pgTable(
  "school_membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => school.id, { onDelete: "cascade" }),
    status: membershipStatus("status").notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("school_membership_user_school_uq").on(t.userId, t.schoolId),
    index("school_membership_school_idx").on(t.schoolId),
  ],
);

/** Platform Super Admins. Being here grants NO access to school records. */
export const platformAdmin = pgTable("platform_admin", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const migrationRunStatus = pgEnum("migration_run_status", ["running", "succeeded", "failed"]);

/** One row per school per migration run (rollout tracking). */
export const schoolMigrationRun = pgTable(
  "school_migration_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => school.id, { onDelete: "cascade" }),
    fromVersion: integer("from_version").notNull(),
    toVersion: integer("to_version"),
    status: migrationRunStatus("status").notNull(),
    error: text("error"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("school_migration_run_school_idx").on(t.schoolId, t.startedAt)],
);

/** Append-only. The app role has INSERT/SELECT only (see scripts/db-grants.ts). */
export const platformAuditEvent = pgTable(
  "platform_audit_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    schoolId: uuid("school_id"),
    ipAddress: text("ip_address"),
    context: jsonb("context").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("platform_audit_at_idx").on(t.at),
    index("platform_audit_actor_idx").on(t.actorUserId, t.at),
    // Lockout lookups: failed logins per identifier in a time window.
    index("platform_audit_action_target_idx").on(t.action, t.targetId, t.at),
  ],
);
