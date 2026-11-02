# Deployment

**Status:** the Dockerfile and compose file are written but have **not yet been built or run** (no Docker
daemon in the environment where Milestone 1 was developed). Build them once locally before relying on them.
Hosting location is pending the legal review (see SECURITY.md).

## Images

```bash
docker build --target app -t zsp-app .   # web server (Next.js standalone), runs as non-root, port 3000
docker build --target ops -t zsp-ops .   # migrations, provisioning, health, backups (tsx + pg_dump 16)
```

No secrets are needed at build time.

## Environments

Separate accounts/projects for **development**, **staging** (fake data only) and **production**. Real student
data never leaves production.

## Production topology

- 2+ `app` containers behind a TLS-terminating load balancer that **sets and overwrites** the client-IP header
  named in `AUTH_CLIENT_IP_HEADER` (e.g. `x-forwarded-for` or `cf-connecting-ip`).
- PgBouncer in transaction mode in front of Postgres. Set `SCHOOL_DB_HOST`/`SCHOOL_DB_PORT` to PgBouncer.
- Managed PostgreSQL 16 with continuous backups / point-in-time recovery, private network only.
- Scheduled `ops` jobs: `npm run school -- health` (every 5 min), `npm run backup` (nightly).

## Environment variables

See `.env.example`. In production, inject from a secrets manager. Notes:

- `PLATFORM_DATABASE_URL` uses the least-privilege `platform_app` role; `PLATFORM_MIGRATOR_URL` (owner) and
  `PROVISIONER_DATABASE_URL` (CREATEDB + CREATEROLE, not superuser) are given **only** to the `ops` container.
- `SCHOOL_DB_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`: 32+ random bytes each, different
  per environment. Losing `SCHOOL_DB_ENCRYPTION_KEY` means re-keying every school role.
- `BETTER_AUTH_URL`: the public https origin.

## Release procedure

1. Merge to `main` (CI green, reviewed).
2. `ops`: `npm run db:migrate:platform`.
3. `ops`: `npm run db:migrate:schools` and check every school reports `ok`.
4. Roll out `app` containers. A school whose migration failed shows a maintenance page until it is fixed and re-run.
5. Because migrations are expand-then-contract, old containers keep working during steps 2–4.

## Provisioning a school (production)

```bash
docker run --rm --env-file prod-ops.env zsp-ops npm run school -- provision <slug> "<School name>"
```

Then create the headmaster/admin accounts (admin UI planned for Milestone 2).

## Prerequisites still open

- Choose hosting region after legal review; choose an S3-compatible bucket for off-site backups.
- Real DNS name and TLS certificate.
- Error monitoring (Sentry DSN) and a log destination: not wired yet.
- Postgres TLS (`sslmode=verify-full`) settings for the managed provider.
