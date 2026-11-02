# Database design

Source of truth: `src/server/db/platform/schema.ts` and `src/server/db/school/schema.ts`.
Migrations are generated with `npm run db:generate`, reviewed like code, and committed under `drizzle/`.

## platform_core

| Table | Purpose |
| --- | --- |
| `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_two_factor`, `auth_rate_limit` | Better Auth. One user per human; password hash (Argon2id) in `auth_account` |
| `school` | slug, name, status (`provisioning`, `provisioning_failed`, `active`, `suspended`, `archived`) |
| `school_database` | host, port, database and role name, **encrypted** password, schema version, health |
| `school_membership` | user ↔ school, status. Unique (user, school). Routing checks this |
| `platform_admin` | Super Admins. Grants no school access |
| `school_migration_run` | per-school migration history (from/to version, status, error) |
| `platform_audit_event` | append-only: logins (ok/failed/locked), provisioning, membership grants |

## Each school database (`school_0001` …)

| Table | Purpose |
| --- | --- |
| `school_identity` | exactly one row: the school's UUID. Checked on every new connection |
| `person` | a human known to this school, optionally linked to a platform user |
| `person_role` | (person, role key). Role → permission mapping lives in code |
| `student` | stable across years; admission number unique; status |
| `student_guardian` | parent/guardian ↔ student. The only path for parent visibility |
| `audit_event` | append-only school audit log |

| Area | Tables |
| --- | --- |
| Settings | `school_profile` (single row: name, motto, currency, library limits) |
| Structure | `academic_year`, `term`, `form`, `room`, `class`, `subject`, `teaching_group`, `group_member`, `enrolment` (one row per student per year), `staff`, `period` |
| Admissions | `application`, `application_document` |
| Files | `file_object` (storage key under the school's id, sniffed type, size, sha256) |
| Attendance | `attendance_session` (daily or lesson), `attendance_mark`, `absence_explanation` |
| Assessment | `grading_scale`, `assessment`, `mark` (nullable score + status), `submission`, `learning_material` |
| Reports | `report_card` (status + frozen JSON snapshot at approval), `progression` |
| Communication | `announcement`, `notification`, `message_thread`, `message`, `event`, `activity`, `activity_member` |
| Fees | `fee_item`, `ledger_entry` (charge/payment, reversals), `payment_proof` |
| Library | `book`, `loan` |
| Discipline/duties | `discipline_incident`, `duty_assignment` |
| Staff | `staff_attendance`, `leave_request` |
| Timetable | `timetable_entry` (baseline), `timetable_override` (one date) |

Rules:

- History is never overwritten: enrolments and group memberships are rows per year/term.
- Application status, registration and enrolment are separate.
- Missing marks are `NULL` with a status, never zero.
- Money in integer cents with a currency code (USD/ZiG) on every amount.
- UUID primary keys; `created_at`/`updated_at` everywhere; indexes on every foreign key used for lookups.

## Migrations

- One school migration history for **all** schools. `npm run db:migrate:schools` applies it in batches of 10,
  re-applies least-privilege grants, records each run in `school_migration_run`, and stops after 3 failures.
- **Expand, then contract**: add columns/tables in one release, use them in the next, remove old ones after that,
  so the app works on both versions during a rollout.
- The app refuses to query a school whose `schema_version` is behind the build (maintenance page instead).
- Platform migrations run as the owner role (`PLATFORM_MIGRATOR_URL`); the app connects as `platform_app`
  (no DDL, insert-only audit).
