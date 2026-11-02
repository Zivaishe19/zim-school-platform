# Zimbabwe School Platform

Multi-school management platform for Zimbabwean high schools (Forms 1–6, ZIMSEC and Cambridge).
Every school has **its own PostgreSQL database**; a central `platform_core` database holds identities,
memberships and routing only.

**Status:** Milestones 1–5 are built and tested, plus Milestone 6 (scheduling) except automatic timetable
generation. Production-readiness work (load testing, penetration test, off-site backup upload, monitoring) remains.
See [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) for exactly what is and is not done.

## What it does

| Area | Features |
| --- | --- |
| Platform | School provisioning (own DB + role per school), migrations across all schools, health checks, encrypted backups/restore, operator view with no access to school records |
| Accounts | Email or username sign-in, Argon2id, two-step verification (TOTP + backup codes, **required** for headmaster/admin/accounts), forced password change after admin reset, rate limiting + account lockout |
| Setup | School profile, academic years/terms, Forms 1–6, rooms, subjects (ZIMSEC/Cambridge/internal), classes with arbitrary names and streams, teaching groups (whole class, sets, practical groups, individual subject choices), bell schedule, grading scales |
| People | Staff/parent/student accounts and roles, parent ↔ child links, student logins without email, admin password resets |
| Admissions | Public online form per school, walk-in applications, document uploads, status workflow, accept → registered student |
| Students | Directory, CSV import (validated, all-or-nothing, duplicate detection), placement in classes, record hub (attendance, progress, reports, discipline, library) |
| Attendance | Daily and per-lesson registers, parent notification of absence, absence explanations and review, class reports |
| Academic | Assessments (classwork, assignments, tests, exams, coursework, CALA, practicals), weights ≤ 100%, marks with missing/pending/submitted/marked/approved/published, online submissions, learning materials, term results and grades |
| Reports | Class-teacher comments → headmaster approval (frozen snapshot) → publication to parents/students, printable/PDF, audited reopening; end-of-year progression proposals, apply, year closure; copy year structure |
| Communication | Announcements (school, staff, parents, students, forms, classes, groups), in-app notifications, structured parent–school messages per student, events, clubs and sports |
| Administration | Fees (USD and ZiG kept separate), fee items, bulk charging, payments, proof-of-payment upload and verification, reversals, statements; library (catalogue, lending limits, overdue, lost/damaged, CSV import/export); discipline (report → decide, parent visibility); class duties and rotas; staff register, leave, transparent teacher indicators |
| Timetable | Bell schedule, baseline timetable with hard-conflict blocking (teacher, room, students) and soft warnings, one-day changes (cancel, substitute, room, added exams/fixtures) with notifications, week views per school/group/room/teacher/me, CSV import |
| Dashboards | Role-specific: headmaster, admin, teacher, accounts, library, parent, student |

## Quick start (development)

Full instructions: **[INSTALL.md](INSTALL.md)**.

```bash
npm ci
docker compose up -d                       # or use a local PostgreSQL 16
cp .env.example .env                       # then fill the three keys (see INSTALL.md)
sed -e 's/platform_core/platform_core_test/g' -e 's/^SCHOOL_DB_PREFIX=school_/SCHOOL_DB_PREFIX=test_school_/' .env > .env.test
npm run db:setup && npm run db:seed
npm run dev                                # http://localhost:3000
```

Demo accounts (password `Demo-Password-2026!`, development only):

| Sign in as | Role |
| --- | --- |
| `admin@kopje.example.test` | School Administrator, Kopje Heights |
| `head@kopje.example.test` | Headmaster |
| `teacher@kopje.example.test` | Teacher and class teacher of 1 Blue |
| `teacher2@kopje.example.test` | Teacher |
| `accounts@kopje.example.test` | Accounts |
| `library@kopje.example.test` | Library |
| `parent@kopje.example.test` | Parent of two children |
| `rumbi.chikwanha` (username) | Student |
| `admin@umguza.example.test` | School Administrator, Umguza Valley |
| `support@multi.example.test` | System Administrator at both schools |
| `platform@example.test` | Platform Super Admin (no school records) |

Public application form: `http://localhost:3000/apply/kopje-heights`.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` / `npm run build` | Dev server / production build |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | 79 unit, integration and isolation tests on real test databases (rebuilt each run) |
| `npm run test:e2e` | 11 Playwright journeys × phone + desktop (needs a running app with the dev seed) |
| `npm run db:generate` | Generate SQL migrations after editing a schema file |
| `npm run db:migrate:platform` / `db:migrate:schools` | Apply migrations to platform / every school |
| `npm run school -- provision <slug> "<Name>"` | Provision a new school |
| `npm run school -- list` / `health` | School databases, versions, health |
| `npm run backup` / `npm run restore -- <file> <new_db>` | Encrypted backups / restore |

## Documentation

[INSTALL](INSTALL.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE_DESIGN](DATABASE_DESIGN.md) · [TENANT_ISOLATION](TENANT_ISOLATION.md) ·
[SECURITY](SECURITY.md) · [TESTING](TESTING.md) · [DEPLOYMENT](DEPLOYMENT.md) · [BACKUP_AND_RECOVERY](BACKUP_AND_RECOVERY.md) ·
[CONTRIBUTING](CONTRIBUTING.md) · [PROJECT_ROADMAP](PROJECT_ROADMAP.md) · [CHANGELOG](CHANGELOG.md)

Never commit `.env*` files (except `.env.example`), database dumps, backups, uploaded files or real student data.
