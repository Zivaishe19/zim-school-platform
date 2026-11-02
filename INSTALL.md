# Installing and running

This guide is for the developers and for whoever operates the servers. The user manual (for school staff,
parents and students) is a separate document.

## 1. Requirements

| Need | Version | Notes |
| --- | --- | --- |
| Node.js | 22 LTS | `node -v` |
| PostgreSQL | 16 | Local, Docker (`docker compose up -d`) or managed |
| `pg_dump` / `pg_restore` | 16 or newer | Only for backups/restores |
| Git | any recent | |
| Docker | optional for dev, required for the production images | |

## 2. Get the code

```bash
git clone <your-repo-url> zim-school-platform
cd zim-school-platform
npm ci
```

From the bundle file instead: `git clone zim-school-platform.bundle zim-school-platform -b feature/full-system`.

## 3. Start PostgreSQL

**Docker (recommended):** `docker compose up -d` starts PostgreSQL 16 on port 5432 (password `devpostgres`) and
PgBouncer on 6432.

**Existing PostgreSQL:** you need a superuser (or a role with CREATEDB and CREATEROLE) for development. Put its
URL in `PROVISIONER_DATABASE_URL` and `PLATFORM_MIGRATOR_URL` below.

## 4. Configure

```bash
cp .env.example .env
node -e "console.log('SCHOOL_DB_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('BACKUP_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('BETTER_AUTH_SECRET='+require('crypto').randomBytes(48).toString('base64url'))"
```

Paste the three lines into `.env`. Then create the test configuration (separate databases):

```bash
sed -e 's/platform_core/platform_core_test/g' -e 's/^SCHOOL_DB_PREFIX=school_/SCHOOL_DB_PREFIX=test_school_/' .env > .env.test
```

| Variable | Meaning |
| --- | --- |
| `PLATFORM_DATABASE_URL` | Least-privilege app role for `platform_core` |
| `PLATFORM_MIGRATOR_URL` | Owner role, used only by migrations |
| `PLATFORM_APP_PASSWORD` | Password `db:setup` gives the app role (development) |
| `PROVISIONER_DATABASE_URL` | Role that creates school databases and roles (points at the `postgres` database) |
| `SCHOOL_DB_HOST`, `SCHOOL_DB_PORT` | Where the app reaches school databases (PgBouncer in production) |
| `SCHOOL_DB_PREFIX` | `school_` (dev/prod), `test_school_` (tests) |
| `SCHOOL_DB_ENCRYPTION_KEY` | Encrypts each school's DB password. **Back it up**: losing it means re-keying every school |
| `BACKUP_ENCRYPTION_KEY` | Encrypts backup files. Store separately from the backups |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Session signing secret; public URL of the site |
| `REQUIRE_MFA_FOR_PRIVILEGED` | `false` only in development. Unset/`true` in staging and production |
| `AUTH_CLIENT_IP_HEADER` | Header your proxy sets with the real client IP |
| `AUTH_SIGNIN_MAX_PER_MINUTE`, `AUTH_ACCOUNT_LOCKOUT_FAILURES` | Brute-force limits (defaults 5 and 10) |
| `FILE_STORAGE_DIR` | Where uploads are kept (persistent volume in production) |
| `TENANT_CACHE_MAX_SCHOOLS`, `TENANT_POOL_MAX` | Connection cache size (defaults 200 schools, 3 connections each) |

## 5. Create the databases and demo data

```bash
npm run db:setup      # platform database, app role, migrations
npm run db:seed       # two fictional schools with demo users (development only)
npm run dev           # http://localhost:3000
```

Sign in with any demo account from the README (password `Demo-Password-2026!`).
Start again at any time: `npm run db:reset && npm run db:setup && npm run db:seed`.

## 6. Run the checks

```bash
npm run lint && npm run typecheck
npm test                      # drops and rebuilds the TEST databases each run
AUTH_SIGNIN_MAX_PER_MINUTE=200 npm run dev     # in another terminal, for e2e
npx playwright install chromium               # once
npm run test:e2e
```

## 7. Production

1. **Before anything:** legal review (Cyber and Data Protection Act, POTRAZ licence, hosting location).
2. Managed PostgreSQL 16 on a private network, with point-in-time recovery switched on.
3. Create roles: an owner/migrator for `platform_core`, a least-privilege `platform_app`, and a provisioner with
   `CREATEDB CREATEROLE` (not superuser).
4. PgBouncer in **transaction** mode in front of Postgres; point `SCHOOL_DB_HOST/PORT` at it.
5. Build the images: `docker build --target app -t zsp-app .` and `docker build --target ops -t zsp-ops .`
6. Secrets from your secrets manager (never in files in the image). Keep `REQUIRE_MFA_FOR_PRIVILEGED` on.
7. Migrate: `docker run --env-file ops.env zsp-ops npm run db:migrate:platform`, then `... npm run db:migrate:schools`.
8. Run 2+ `zsp-app` containers behind an HTTPS load balancer that sets `AUTH_CLIENT_IP_HEADER`, with a shared
   persistent volume mounted at `FILE_STORAGE_DIR`.
9. Create the first school: `docker run --env-file ops.env zsp-ops npm run school -- provision <slug> "<School name>"`.
10. Create its first administrator: `... npm run school -- add-admin <slug> <email> "<Full name>"`. It prints a
    one-time temporary password; the administrator must change it and set up two-step verification at first
    sign-in, then sets up the school from **Setup** and adds the other staff from **People**.
11. Schedule `npm run school -- health` (every 5 minutes) and `npm run backup` (nightly) in the ops container, and
    copy backups off-site.

Release procedure, topology and open items: [DEPLOYMENT.md](DEPLOYMENT.md). Restores: [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).

## 8. Everyday operations

| Task | Command |
| --- | --- |
| New school | `npm run school -- provision <slug> "<Name>"` |
| First administrator of a school | `npm run school -- add-admin <slug> <email> "<Full name>"` |
| List schools and versions | `npm run school -- list` |
| Health check | `npm run school -- health` |
| After a release with migrations | `npm run db:migrate:platform && npm run db:migrate:schools` |
| Backup everything | `npm run backup` |
| Restore one school beside the live one | `npm run restore -- backups/<stamp>/school_0007.dump.enc school_0007_restore` |

## 9. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Invalid server environment. Check: …` | A variable in `.env` is missing or malformed (e.g. a key not 32 bytes) |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running |
| A school shows "This school is being updated" | Its database is behind the app's schema: run `npm run db:migrate:schools` |
| Users are sent to "My account" | Their password was reset (must change), or their role needs two-step verification |
| "Too many attempts" at sign-in | Rate limit or account lockout (15 minutes); check `AUTH_CLIENT_IP_HEADER` behind a proxy |
| Upload refused | Only PDF/JPEG/PNG/WebP up to 5 MB are accepted |
| `npm test` fails at setup | `.env.test` missing, or its database names do not contain `_test` |
