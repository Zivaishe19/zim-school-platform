# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/), versions: SemVer.

## [Unreleased]

### Added (Milestones 1b–6)

- Two-step verification (set-up screen, login step, required for privileged roles); admin password resets;
  forced password change; My account page.
- People and roles management; parent links; student logins.
- Setup: school profile, years/terms, forms, rooms, subjects, classes, teaching groups, enrolment, bell
  schedule, grading scales; progression, year closure, structure copy.
- Admissions (public form, walk-in, documents, workflow); CSV student import.
- Attendance (daily/lesson, notifications, explanations, reports); assessments, marks, submissions,
  materials, results; report cards with approval, freezing, publication, printing, audited reopening.
- Announcements, notifications, structured messages, events, clubs and sports.
- Fees, proofs of payment, library, discipline, class duties, staff register, leave, teacher indicators.
- Timetable with conflict detection, one-day changes, week views, CSV import.
- Role dashboards; private file storage with authorized downloads.
- 27 module isolation tests and 6 more browser journeys; demo seed covering every module.

### Fixed

- Admission forms rejected Form 1 applications when the transfer-form field was blank (found by e2e test).

### Added (Milestone 1: Foundation)

- Next.js 16 app (TypeScript strict, Tailwind 4), strict nonce-based CSP and security headers.
- `platform_core` schema and least-privilege `platform_app` role; append-only platform audit log.
- Database-per-school: provisioning CLI, per-school login roles, encrypted credentials, identity check,
  LRU connection cache, per-school migration runner with run history and schema-version gate, health checks.
- Better Auth: email/username sign-in, Argon2id, database sessions, IP rate limiting, per-account lockout,
  login success/failure audit, TOTP tables (UI pending).
- RBAC with nine school roles and relationship-scoped student access.
- Pages: login, school picker, school dashboard, students list/search/detail/create, platform admin.
- Encrypted per-database backup and restore scripts.
- Test suites: 52 unit/integration/isolation tests (real Postgres, also verified through PgBouncer) and
  10 Playwright e2e tests (mobile + desktop, dev and production builds).
- CI workflow, Dockerfile (`app`, `ops`), docker-compose for Postgres + PgBouncer, project documentation.

### Changed from the original specification

- Drizzle ORM instead of Prisma; Better Auth instead of Auth.js (reasons in ARCHITECTURE.md).
