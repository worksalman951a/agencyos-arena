# Backup and restore verification runbook (proposed)

**Status: verification workflow only; no backup job or restore has been implemented or tested in this checkout.** The architecture proposal describes daily PostgreSQL dumps to object storage with 30-day retention, but the implementation/deployment search found no executable backup, restore, or restore-test procedure. The hosting and object-storage decisions remain unapproved. This runbook does not claim production recovery readiness.

## Safety invariants

- Never reset, drop, truncate, overwrite, or restore into the development database.
- Restore only to a newly provisioned, dedicated, disposable PostgreSQL instance and a uniquely named database prefixed `agencyos_restore_verify_`. Do not use the development Compose database or copy its `DATABASE_URL`.
- PostgreSQL must use the reserved port **5433** and the app, if needed for a smoke check, must use **3001**. If 5433 is occupied by a development database, stop and provision a separate isolated environment; do not connect to, stop, or remap over it. Never use port 3000 or the separate Codex project.
- Use a synthetic/sanitized backup unless the data owner has approved the backup for recovery testing. Keep credentials out of shell history, logs, tickets, and this document.
- Do not use `pg_restore --clean`, `dropdb`, `prisma db push`, or `prisma migrate dev` in this verification workflow.

## Verification procedure

1. **Prepare an isolated target.** Provision a disposable PostgreSQL instance with no network route or credentials to the development/production database. Confirm it listens only on the approved isolated environment's port 5433. Provision a database/user dedicated to this run; the database name must begin with `agencyos_restore_verify_` and must not already exist.
2. **Select and identify a backup.** Record the backup creation time, PostgreSQL major version, source environment identifier, archive size, and SHA-256. Confirm the archive is readable with `pg_restore --list`. Do not publish a connection string or archive contents in verification logs.
3. **Pin the target explicitly.** Supply separate, operator-controlled `RESTORE_VERIFY_ADMIN_URL` and `RESTORE_VERIFY_DATABASE_URL` values for the isolated instance. Before creating the database, verify server address, port `5433`, server version, and the expected database prefix using a read-only connection check. Abort if any value points to the development or production database.
4. **Restore into a new database.** Create the uniquely named database on that isolated instance, then restore the archive with `pg_restore --exit-on-error --single-transaction --no-owner --dbname="$RESTORE_VERIFY_DATABASE_URL" "$BACKUP_FILE"`. Do not add `--clean`; do not reuse an existing database. If restore fails, preserve the disposable instance and logs for diagnosis rather than retrying against another target.
5. **Verify recovery.** Check that restore completed without errors; confirm expected schema and migration history with read-only SQL and `npx prisma migrate status` pointed explicitly at `RESTORE_VERIFY_DATABASE_URL`; compare agreed table counts or checksums with the backup manifest; and run a read-only application smoke check if required. Any application or integration test that writes data must run only against this isolated synthetic database and on port 3001.
6. **Capture evidence.** Record the backup checksum, source and target identifiers (not credentials), PostgreSQL versions, restore duration, command exit status, migration status, comparison results, exceptions, and reviewer sign-off. Store the evidence in the approved restricted operational location.
7. **Clean up safely.** Retain the isolated target until the recovery reviewer accepts the evidence. Then remove only the disposable instance and database created for this run, after rechecking its environment and `agencyos_restore_verify_` name. Never run broad cleanup commands or delete/overwrite a source backup as part of verification.

## Required before production recovery can be claimed

Approve the backup destination, encryption/key ownership, schedule, retention, monitoring/alerting, access policy, RPO/RTO, and restore ownership; implement and operationally test the backup job and restore automation; and repeat this workflow on a representative approved backup. A successful restore verification alone does not prove that scheduled backups, off-site retention, or production recovery objectives are met.
