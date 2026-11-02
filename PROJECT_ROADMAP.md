# Project roadmap and status

✅ built and covered by tests · 🟡 partly built · ⬜ not built

## Milestone 1 – Foundation ✅

Database-per-school provisioning, tenant routing, client cache with identity check, per-school migrations,
health checks, Better Auth (Argon2id, sessions, rate limiting, account lockout), RBAC with relationship
scopes, audit logs, encrypted backups/restore, CI, Dockerfile.

## Milestone 1b – Account security ✅ (except one item)

| Item | Status |
| --- | --- |
| Two-step verification (TOTP + backup codes) set-up screen and login step | ✅ |
| MFA **required** for headmaster, school/system admin, accounts (`REQUIRE_MFA_FOR_PRIVILEGED`) | ✅ |
| Admin-assisted password reset (forces change, signs out everywhere, refused for accounts used at other schools) | ✅ |
| User and role management screens | ✅ |
| Self-service recovery by email/SMS one-time code | ⬜ needs an email/SMS provider and credentials |
| Re-authentication prompt before sensitive actions | ⬜ |

## Milestone 2 – School and student management ✅

Years/terms, forms, rooms, subjects, classes, teaching groups, enrolment, admissions (online + walk-in,
documents, workflow), parent/student accounts, staff accounts, CSV student import.
Not built: Excel (.xlsx) import directly (save as CSV instead); configurable per-school admission requirement lists.

## Milestone 3 – Academic operations ✅

Daily and lesson attendance, absence explanations, assessments of every kind, marks with full status workflow,
weighting validation, grading scales, online submissions, learning materials, report cards with approval and
publication, progression proposals, year closure, structure copy.
Not built: ⬜ online examinations (timed tests in the browser); ⬜ special placement rules for Form 3/4/Lower Six
beyond manual decisions (decisions are fully manual today); ⬜ server-generated PDF (browser "Save as PDF" is used).

## Milestone 4 – Communication ✅

Announcements with audiences, in-app notifications, structured parent–school messages, events, clubs and sports.
Not built: ⬜ SMS/WhatsApp/email delivery (needs a provider); ⬜ meeting booking slots.

## Milestone 5 – Administration ✅

Fees (fee items, bulk charges, payments, proof of payment + verification, reversals, USD/ZiG), library,
discipline, class duties/rotas, staff register, leave, teacher indicators.
Not built: ⬜ instalment plans (partial payments work; plans are not modelled); ⬜ payment gateway (EcoCash API).

## Milestone 6 – Scheduling 🟡

✅ Bell schedule, baseline timetable with hard-conflict checks and soft warnings, one-day changes with
notifications, week views, CSV import, sports/exam entries.
⬜ Automatic timetable generation (planned with OR-Tools CP-SAT in a separate Python worker).

## Milestone 7 – Production readiness ⬜

| Item | Status |
| --- | --- |
| Role dashboards | ✅ |
| Off-site backup upload (S3-compatible) | ⬜ needs bucket credentials |
| S3-compatible file storage driver (local disk works today) | ⬜ |
| Malware scanning of uploads (ClamAV) | ⬜ |
| Background job queue (pg-boss) for large imports/notifications | ⬜ (operations are synchronous with size limits today) |
| Sentry / structured logging | ⬜ needs DSN |
| Load tests (10,000-student school, 50 schools) | ⬜ |
| External penetration test, legal review (Cyber and Data Protection Act, POTRAZ licence) | ⬜ |
| Docker images built and run in staging | ⬜ (Dockerfile written, not yet built) |
| CI run on GitHub | ⬜ (workflow written, not yet run) |

## Open business decisions (defaults in use)

| Question | Default implemented |
| --- | --- |
| Rankings | Not shown anywhere (no ranking screens built) |
| Report card approval chain | Class teacher → headmaster |
| Fee balances blocking reports | Never |
| One invoice mixing USD and ZiG | Not possible: every amount has one currency |
| Absence notifications | In-app to guardians when a child is marked absent in the daily register |
| Teacher indicators | Descriptive only, last 30 days, no single score, not based on marks |
