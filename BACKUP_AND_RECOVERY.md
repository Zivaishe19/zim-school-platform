# Backup and recovery

Two layers, because they solve different problems:

| Layer | Restores | How |
| --- | --- | --- |
| Managed Postgres PITR (provider) | The **whole cluster** to any point in time | Provider console/API |
| Per-database encrypted dumps (`npm run backup`) | **One school** (or the platform DB) without touching others | This repo |

## Per-database backups (implemented)

`npm run backup` writes `backups/<UTC stamp>/<database>.dump.enc` for `platform_core` and every school, plus a
`manifest.json` (size + SHA-256 per file).

- Format: `pg_dump -Fc`, encrypted with AES-256-GCM (`BACKUP_ENCRYPTION_KEY`); see `scripts/lib/backup.ts`.
- A tampered file or wrong key fails authentication **before** `pg_restore` sees any data (tested).
- The key must be stored separately from the backup files (different account/secret store).
- **Not yet implemented:** upload to off-site S3-compatible storage. It needs a bucket and credentials in a
  separate account; until then, copy the backup directory off-site with your provider's tooling.
- Suggested retention: nightly × 30 days, monthly × 12 months, and the end-of-academic-year backup kept per school
  policy (confirm in legal review).

## Restore one school

Never restore over a live database.

```bash
npm run restore -- backups/<stamp>/school_0007.dump.enc school_0007_restore
```

Then:

1. Check it: `psql …/school_0007_restore -c "select school_id from school_identity"` must equal the school's UUID.
2. Re-apply grants for the school role: `npm run school -- migrate-all` re-applies grants after migrating
   (or call `applySchoolGrants('school_0007_restore', 'school_0007_app')`).
3. Switch routing: update `school_database.database_name` for that school to `school_0007_restore`
   (record who and why in the platform audit log).
4. The app evicts nothing automatically yet: restart app containers or wait 10 minutes for idle clients to expire.
5. Keep the old database until the school confirms the data, then drop it.

## Restore to a point in time (one school)

1. Restore the cluster via PITR to a **temporary** instance at the chosen time.
2. `pg_dump` that school's database from the temporary instance, encrypt with the backup script, restore as above.
3. Delete the temporary instance.

## Drills

The automated test `tests/isolation/backup-restore.test.ts` backs up a school, restores it to a new database and
compares row counts and identity on every CI run. Do a full manual drill on staging every quarter and record it.
