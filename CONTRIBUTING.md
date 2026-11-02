# Contributing

## Branches

- `main`: production-ready. Protected. Never commit directly.
- `develop`: integration. Protected. All feature PRs target `develop`.
- Work branches: `feature/<issue>-<short-name>`, `fix/<issue>-<short-name>`, `chore/…`
  (e.g. `feature/12-academic-years`, `fix/31-tenant-security`).

## Flow

1. Pick or open a GitHub Issue (use the Feature template: purpose, roles, data, security, tests).
2. Branch from `develop`.
3. Before changing code, read the affected module and `TENANT_ISOLATION.md`.
4. Schema change → edit `src/server/db/*/schema.ts` → `npm run db:generate` → review the SQL → commit it.
5. Run `npm run lint && npm run typecheck && npm test` locally.
6. Open a PR to `develop`, fill in the template, ask for review. Keep PRs under ~400 changed lines.
7. Squash-merge when CI is green and approved.
8. Release: PR `develop` → `main`.

## GitHub settings to enable (repository admin, once)

- Branch protection on `main` and `develop`: require PR, 1 approval (2 for CODEOWNERS paths), status checks
  "Lint, types, tests, build", up-to-date branches, no force pushes.
- Replace the placeholder team in `.github/CODEOWNERS`, then enable "Require review from Code Owners".
- Secret scanning + push protection, Dependabot alerts, private vulnerability reporting.
- GitHub Projects board with columns Backlog / Ready / In progress / In review / Done.

## Conventions

- Commits: Conventional Commits (`feat(students): add CSV import`, `fix(tenancy): …`).
- TypeScript strict; no `any` without a comment explaining why.
- Validation with Zod in `modules/<x>/schemas.ts`; logic and authorization in `service.ts`; pages stay thin.
- No new dependency without a short justification in the PR.
- Never commit `.env*`, dumps, backups or real student data. Use the fictional seed.

## AI-assisted code

Allowed, but you own it: read every line, make sure it follows these conventions and the isolation rules,
and add tests. Never paste real student or staff data, credentials or production logs into AI tools.
