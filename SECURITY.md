# Security

## Reporting a vulnerability

Do **not** open a public issue. Email the security contact for this repository (set this before launch:
`security@<your-domain>`) or use GitHub's private vulnerability reporting. Anything that could expose one
school's or one family's data to another is treated as critical.

## Controls in place (Milestone 1)

Reference: OWASP ASVS 4.0 Level 2.

| Area | Control |
| --- | --- |
| Passwords | Argon2id (m=19 MiB, t=2, p=1) via `@node-rs/argon2`; length 10–128; no self sign-up |
| Sessions | Database sessions, HttpOnly cookies, `Secure` + `__Secure-` prefix in production, 12-hour expiry, revoked on password reset |
| Brute force | 5 sign-ins/minute per IP (shared store) **and** per-account lockout after 10 failures in 15 minutes; failures and lockouts audited |
| Client IP | Read only from `AUTH_CLIENT_IP_HEADER`, which **your** proxy must set and overwrite |
| Authorization | Server-side only: membership → roles → permission → relationship scope in SQL; 404 for not-yours |
| Tenant isolation | See TENANT_ISOLATION.md |
| Injection | Parameterised queries (Drizzle/pg); identifiers in DDL validated + escaped |
| XSS / clickjacking | React escaping; strict nonce-based CSP; `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| CSRF | Better Auth origin checks; Next.js server actions check Origin |
| Transport | HSTS (2 years, preload); TLS terminates at the load balancer; DB connections should use TLS in production |
| Secrets | Environment only; school DB passwords encrypted at rest (AES-256-GCM); `.env*` git-ignored |
| Audit | Append-only tables enforced by Postgres grants (app roles have INSERT/SELECT only) |
| Backups | AES-256-GCM encrypted, authenticated; tampered files rejected before any restore |

## Implemented since Milestone 1

- Two-step verification (TOTP + backup codes), **required** for headmaster, school/system administrators and
  accounts staff (`REQUIRE_MFA_FOR_PRIVILEGED`, on unless set to `false`).
- Administrator password resets: temporary password, forced change, all sessions revoked, audited; refused for
  accounts used at another school and for platform administrators.
- Private file storage: content-type sniffing (PDF/JPEG/PNG/WebP), 5 MB limit, random keys under the school's
  id, downloads only through `/s/<school>/files/<id>` after checking the owning record, audited,
  `Content-Disposition: attachment`, sandbox CSP.
- Public admission form: validated, 5 submissions per network per hour.
- Append-mostly fee ledger: corrections are reversals with reasons.

## Not yet implemented

- Self-service password recovery by email/SMS (needs a provider).
- Re-authentication prompts before sensitive actions (sessions are "fresh" for 10 minutes in configuration).
- Malware scanning of uploads (ClamAV) and an S3-compatible storage driver.
- External penetration test, before production.

## Dependency policy

CI fails on high/critical advisories in production dependencies. Dependabot opens weekly PRs.
Known: a moderate advisory in `esbuild` pulled in by `drizzle-kit` (development tool only, not shipped).

## Data protection

Zimbabwe's Cyber and Data Protection Act [Chapter 12:07] and SI 155 of 2024 apply (POTRAZ data controller
licensing, Data Protection Officer). Legal review is required before production, especially for children's
data, consent, hosting location, retention and breach notification.
