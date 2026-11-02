# Testing

## Suites

| Suite | Command | What | Speed |
| --- | --- | --- | --- |
| Unit | `npm test` | RBAC grants, secret envelope, names, Argon2id | ms |
| Isolation and integration | `npm test` | Real Postgres: two independently provisioned schools (`test_school_0001/0002`) rebuilt every run | ~15 s |
| End-to-end | `npm run test:e2e` | 11 journeys on a Pixel 7 profile and desktop Chrome, against the dev seed (sign-in, school switch, register, proof of payment → verification, report card, student areas, report approval, public application) | ~25 s |

`npm test` uses `.env.test` and **drops and recreates** `platform_core_test` and every `test_school_*`
database (see `tests/global-setup.ts`). It refuses to run fixtures against a database whose name lacks `_test`.

Current coverage: 79 tests. Foundation (52): Postgres role isolation, append-only audit, tenant resolution,
suspended membership/school, malformed slugs, routing mis-wiring (identity check), schema-behind,
cross-school IDOR on reads and writes, parent/student/teacher/headmaster/admin scopes, provisioning
idempotency, migration runs, health checks, encrypted backup + single-school restore + tamper rejection,
per-account lockout. Modules (27): see `tests/isolation/modules.test.ts` — teacher scope, registers, absence notifications and explanations, missing-is-not-zero, publication rules, report approval and freezing, fees (proof not credited until verified, duplicates, USD/ZiG, reversals), file access, discipline visibility, message participants, audiences, library limits, timetable conflicts and overrides, admissions workflow and public rate limit, cross-school password resets, progression.

## Through PgBouncer

To run the suite through PgBouncer in transaction mode (as production does): start `docker compose up -d`,
copy `.env.test` to `.env.test.pgbouncer` with `SCHOOL_DB_PORT=6432`, then
`ENV_FILE=.env.test.pgbouncer npx vitest run`.

## End-to-end locally

```bash
npm run db:reset && npm run db:setup && npm run db:seed
AUTH_SIGNIN_MAX_PER_MINUTE=100 npm run dev     # the e2e suite signs in many times from one IP
npx playwright install chromium                # once
npm run test:e2e
```

## Rules

- A feature is not done until its tests pass in CI and the PR is reviewed.
- Every new school table/module adds isolation cases: cross-school read, cross-school write, wrong person in the same school.
- Use fake data only (the seed uses fictional schools and people). Never paste real student data into tests, issues or AI tools.

## Planned

- Load tests (k6): one 10,000-student school and 50 schools; targets to be agreed (proposal: p95 page < 800 ms on a 3G profile).
- Scheduled restore drill against staging (quarterly).
