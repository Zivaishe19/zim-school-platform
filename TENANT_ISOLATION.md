# Tenant isolation

Goal: a user of one school can never read or change another school's records, and inside a school a
user can never reach records that are not theirs. Database-per-school is the outer wall; it does not
replace the inner checks.

## Layers

| Layer | Control | Where | Test |
| --- | --- | --- | --- |
| Postgres | One login role per school with `CONNECT` on its own database only; `PUBLIC` revoked | `tenancy/admin.ts` | "school A's role cannot connect to school B's database", "…to the platform database" |
| Postgres | App role cannot run DDL, update/delete `audit_event`, or change `school_identity` | `applySchoolGrants` | "app role cannot alter the audit log or the schema" |
| Credentials | Generated per school, stored AES-256-GCM encrypted in `platform_core`, key only in server env | `tenancy/secrets.ts` | unit tests (tamper / wrong key) |
| Routing | School resolved from the user's **active membership** + slug; slug is untrusted, validated, only selects among memberships | `tenancy/context.ts` | "rejects a school the user is not a member of", malformed slugs, suspended membership/school |
| Client cache | Keyed by school UUID from `platform_core`; on connect, `school_identity` must equal that UUID or the client is refused | `tenancy/client-cache.ts` | "refuses a connection that reaches another school's database" (routing rows swapped) |
| Schema version | A school behind the build's schema is shown a maintenance page, never queried | `client-cache.ts` | "refuses to serve a school whose schema is behind" |
| Services | Visibility scope in SQL: `view_all`, else `view_linked` (guardian join), else `view_self`, else Forbidden; unknown and not-yours both return null → 404 | `modules/students/service.ts` | `ownership.test.ts`, IDOR cases |
| Writes | Only through the context's DB; audit row in the same transaction | services | "writes land only in the acting school's database" |
| HTTP | No membership → 404, no session → /login | pages/actions | e2e + manual probes |
| Platform operators | Super Admins have no school membership and no school-record screens | `platform/admins.ts` | "platform super admins get no school access by default" |

## Rules for every new feature

1. Entry points call `requireSchoolContext(slug)` first: pages, layouts, server actions, route handlers, file downloads.
2. Services take a `SchoolContext`. Never accept a school ID, database name or connection details from a request.
3. Put the ownership rule in the query (`where … and <scope>`), not in an `if` after loading.
4. Return "not found" for "not allowed" on single-record reads.
5. Background jobs carry only the school UUID and resolve everything else server-side.
6. Add cases to `tests/isolation/` for the new tables: cross-school read, cross-school write, and wrong-person-same-school.

## Module coverage

Every module service takes a `SchoolContext` and applies `studentVisibility()` (or a stricter relationship rule):
teachers see students in their classes and teaching groups, parents their linked children, students themselves.
`tests/isolation/modules.test.ts` checks, for attendance, assessments/marks, report cards, fees and files,
discipline, messages, announcements, events, library, timetable, admissions, people and progression: cross-school
reads, wrong-person reads/writes in the same school, and each module's key rule.

## Known gaps (tracked)

- Break-glass support access for Super Admins (time-limited, school-approved, audited) is not built; operators
  simply have no access to school records.
- Transfers between schools (an explicit, approved transfer packet) are not built; records stay with each school.
