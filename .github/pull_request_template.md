## What and why

Closes #

## Affected modules and data

- Modules:
- Database changes (migration files under `drizzle/`):
- Permissions added or changed (`src/server/rbac/roles.ts`):

## Security and privacy checklist

- [ ] Every new page, server action and route handler goes through `requireSchoolContext()` (or `requirePlatformAdmin()`)
- [ ] Resource ownership is checked in the service, not only hidden in the UI
- [ ] Inputs validated with Zod; no raw SQL without review
- [ ] Sensitive changes write an audit event in the same transaction
- [ ] New school-scoped tables/modules have cases in `tests/isolation/`
- [ ] No secrets, real student data or database dumps in this PR
- [ ] Migrations are backward compatible (expand, then contract)

## Tests

- [ ] `npm run lint && npm run typecheck && npm test` pass locally
- [ ] E2E updated if a user flow changed

## AI-generated code

- [ ] I have read and understood every line I am submitting, including AI-generated code
