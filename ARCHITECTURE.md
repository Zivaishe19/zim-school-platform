# Architecture

A modular monolith: one Next.js codebase, deployed as identical stateless web containers plus an
`ops` image for privileged jobs. One `platform_core` database, one database per school.

```
Browser ──HTTPS──▶ Load balancer ──▶ Next.js app containers (×N)
                                        │  requireSchoolContext() on every school entry point
                                        ▼
                                     PgBouncer (transaction mode)
                                        ▼
                         Postgres cluster(s): platform_core, school_0001 … school_NNNN

ops container (CLI / scheduled jobs): provisioning, migrations, health checks, backups
```

## Folder structure

```
drizzle/platform, drizzle/school   SQL migrations (generated, reviewed, committed)
scripts/                           CLI: db-setup, school-admin (provision/migrate/health), seed, backup, restore
src/app/                           Routes only; thin pages and server actions
  login/, schools/, admin/         sign-in, school picker, platform operator view
  s/[schoolSlug]/…                 all school portals
src/modules/<module>/              Feature modules: service.ts (Zod validation, logic, authorization)
  setup, people, students, imports, admissions, attendance, assessments, reports,
  comms (announcements, notifications, messages, events, activities), fees, library,
  discipline (incidents, duties), staff, timetable
src/app/s/[schoolSlug]/_actions/   Server actions (thin: schoolAction() re-checks membership, then calls services)
src/app/apply/[schoolSlug]         Public online application form
src/server/
  env.ts                           validated server environment
  auth/                            Better Auth config, password hashing, sessions, account creation
  db/platform, db/school           Drizzle schemas (+ platform client)
  tenancy/                         ★ routing, client cache, provisioning, grants, secrets, scope.ts (who sees which students)
  files/                           private storage + authorization of downloads
  rbac/roles.ts                    roles → permissions (pure, unit tested)
  audit/                           school audit helper
  platform/                        platform-operator helpers
src/ui/                            shared accessible components
src/proxy.ts                       per-request CSP nonce (no auth logic here)
tests/unit, tests/isolation, tests/e2e
```

## Request flow (school pages)

1. `src/proxy.ts` sets a CSP nonce. Nothing else.
2. Page/action calls `requireSchoolContext(slug)` (`src/server/tenancy/context.ts`):
   session → active membership in an active school with that slug → cached school DB client → this user's
   person record and roles. No membership: **404**.
3. The page calls a module service with that context. The service checks the permission **and** the
   relationship (e.g. parent ↔ child) in SQL, so a wrong ID returns "not found", never another person's record.
4. Writes run in a transaction together with their audit row.

## Module rules

- Services accept only a `SchoolContext`, never a raw school ID or DB handle.
- A module uses another module only through its exported service functions.
- Every server action re-runs `requireSchoolContext()`; server actions are public POST endpoints.
- New permissions go in `src/server/rbac/roles.ts` (reviewed by CODEOWNERS).

## Decisions

| Decision | Why |
| --- | --- |
| **Database per school** | Strongest isolation boundary; a school can move to its own server by restoring its DB elsewhere and updating one row. |
| **Drizzle ORM instead of Prisma** | Prisma 7's CLI (`generate`, `migrate`) downloads a native engine binary; it could not run in our build sandbox, and restricted networks are realistic for us. More importantly, Drizzle runs migrations **from code against any connection**, which our per-school migration runner needs (`migrateAllSchools`), and a client per school is just a thin wrapper over a `pg` pool. Drizzle is maintained, typed, and its migration generator is pure JavaScript. |
| **Better Auth instead of Auth.js** | Auth.js is now maintained by the Better Auth team, who recommend Better Auth for new projects. Better Auth gives database sessions, rate limiting with shared storage, username login (students without email) and TOTP. Passwords use Argon2id via `@node-rs/argon2`. |
| **Next.js Cache Components off** | Almost every page is per-user, per-school. We prefer explicit dynamic rendering to any chance of caching one user's render for another. Revisit for public pages. |
| **PgBouncer, transaction mode** | Many containers × many cached schools × small pools would exhaust Postgres connections. Verified: the full test suite passes through PgBouncer 1.22 in transaction mode. |
| **LRU client cache** (`TENANT_CACHE_MAX_SCHOOLS`, default 200; pool max 3) | Idle schools hold no connections; each new client proves which DB it reached via `school_identity`. |
| **Self-hosted Docker, not serverless** | The client cache needs long-lived processes. |
| **No job queue yet** | Milestone 1 jobs run from the CLI/`ops` image. pg-boss (Postgres-backed) is planned for Milestone 2 bulk imports and notifications. |
