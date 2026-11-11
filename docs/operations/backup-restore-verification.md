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

## Windows PowerShell command template

Use a fresh PowerShell session. Provision `RESTORE_VERIFY_ADMIN_URL` and `RESTORE_VERIFY_DATABASE_URL` from the approved secret manager as process-scoped values; do not paste credentials into a command, save them in a script, or print them. The admin URL must name the maintenance database on the isolated PostgreSQL server; the target URL must name a new `agencyos_restore_verify_...` database on that same server. Also set `RESTORE_VERIFY_EXPECTED_SERVER_ADDRESS` from the isolated provider's connection details. These values must not be copied from the application's normal `DATABASE_URL`.

First validate the names and connection target, and perform only read-only checks. If any listener or identity is unexpected, stop; do not kill, stop, or connect to an unknown service:

```powershell
$ErrorActionPreference = 'Stop'
if ($env:RESTORE_VERIFY_ISOLATION_CONFIRMATION -ne 'I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET') {
  throw 'First verify out of band that this is a new disposable isolated PostgreSQL instance; then set the confirmation value in this PowerShell session.'
}
if (-not $env:RESTORE_VERIFY_ADMIN_URL -or -not $env:RESTORE_VERIFY_DATABASE_URL -or -not $env:RESTORE_VERIFY_EXPECTED_SERVER_ADDRESS) {
  throw 'Provide the isolated restore URLs and expected server address through the approved secret manager.'
}

$adminUri = [Uri]$env:RESTORE_VERIFY_ADMIN_URL
$targetUri = [Uri]$env:RESTORE_VERIFY_DATABASE_URL
if ($adminUri.Scheme -notin @('postgres', 'postgresql') -or $targetUri.Scheme -notin @('postgres', 'postgresql')) {
  throw 'Both URLs must use the postgres or postgresql scheme.'
}
$adminDb = [Uri]::UnescapeDataString($adminUri.AbsolutePath.TrimStart('/'))
$targetDb = [Uri]::UnescapeDataString($targetUri.AbsolutePath.TrimStart('/'))
if ($adminUri.Port -ne 5433 -or $targetUri.Port -ne 5433) { throw 'Both PostgreSQL URLs must use port 5433.' }
if ($adminUri.DnsSafeHost -ne $targetUri.DnsSafeHost) { throw 'Admin and target URLs must name the same isolated PostgreSQL host.' }
if ($targetDb -notmatch '^agencyos_restore_verify_[A-Za-z0-9_]+$') { throw 'Target database name must use the agencyos_restore_verify_ prefix.' }
if ($adminDb -notmatch '^[A-Za-z0-9_]+$') { throw 'Admin URL must name a simple maintenance database.' }

$listener = Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue
if (-not $listener) { throw 'No PostgreSQL listener is available on the reserved port 5433; provision the isolated target first.' }

# Configure libpq from the secret URL without putting credentials on a command line.
# Split before URL-decoding so an encoded ':' inside a password stays part of the password.
$env:PGUSER = $null
$env:PGPASSWORD = $null
$rawUserInfo = $adminUri.UserInfo
$credentialSeparator = $rawUserInfo.IndexOf(':')
if ($credentialSeparator -ge 0) {
  $rawUser = $rawUserInfo.Substring(0, $credentialSeparator)
  $rawPassword = $rawUserInfo.Substring($credentialSeparator + 1)
} else {
  $rawUser = $rawUserInfo
  $rawPassword = $null
}
$env:PGHOST = $adminUri.DnsSafeHost
$env:PGPORT = '5433'
$env:PGDATABASE = $adminDb
if ($rawUser) { $env:PGUSER = [Uri]::UnescapeDataString($rawUser) }
if ($null -ne $rawPassword) { $env:PGPASSWORD = [Uri]::UnescapeDataString($rawPassword) }

$identity = (& psql -X -v ON_ERROR_STOP=1 -At -c "SELECT current_database() || '|' || COALESCE(inet_server_addr()::text, '') || '|' || inet_server_port()::text || '|' || current_setting('server_version')")
if ($LASTEXITCODE -ne 0) { throw 'Could not identify the isolated PostgreSQL target.' }
$identityParts = ([string]$identity).Split('|', 4)
if ($identityParts.Count -ne 4 -or $identityParts[0] -ne $adminDb -or $identityParts[1] -ne $env:RESTORE_VERIFY_EXPECTED_SERVER_ADDRESS -or $identityParts[2] -ne '5433') {
  throw 'Connected PostgreSQL identity does not match the approved isolated target; stop without creating a database.'
}

$exists = (& psql -X -v ON_ERROR_STOP=1 -At -c "SELECT 1 FROM pg_database WHERE datname = '$targetDb'")
if ($LASTEXITCODE -ne 0) { throw 'Could not check whether the target database already exists.' }
if ($exists) { throw 'Target database already exists; choose a new unique name and never overwrite it.' }

# Verify the approved archive offline against the SHA-256 in its approved manifest.
$BackupFile = 'C:\path\to\approved\synthetic-backup.dump'
$ExpectedBackupSha256 = 'REPLACE_WITH_64_HEX_CHARACTERS_FROM_APPROVED_MANIFEST'
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) { throw 'Set BackupFile to an approved, readable backup archive.' }
if ($ExpectedBackupSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Set ExpectedBackupSha256 from the approved backup manifest.' }
$actualBackupSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $BackupFile).Hash
if ($actualBackupSha256 -ne $ExpectedBackupSha256) { throw 'Backup checksum does not match the approved manifest; do not create or restore a target.' }
Write-Output "Verified backup SHA-256: $actualBackupSha256"
& pg_restore --list $BackupFile > $null
if ($LASTEXITCODE -ne 0) { throw 'Backup archive failed pg_restore --list; do not create or restore a target.' }

# Create only the previously confirmed, new verification database.
& createdb --no-password --maintenance-db=$adminDb $targetDb
if ($LASTEXITCODE -ne 0) { throw 'Could not create the new verification database; preserve logs and stop.' }
$env:PGDATABASE = $targetDb
& pg_restore --exit-on-error --single-transaction --no-owner --no-password --dbname=$targetDb $BackupFile
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; preserve the disposable target and logs for diagnosis.' }

# Read-only recovery checks. DATABASE_URL is pointed explicitly at the disposable restore.
$env:DATABASE_URL = $env:RESTORE_VERIFY_DATABASE_URL
npx prisma migrate status
if ($LASTEXITCODE -ne 0) { throw 'Prisma migration status failed against the disposable restore.' }
# Run approved, read-only table/migration checks here; compare them to the backup manifest.
```

`BackupFile` above is a documentation placeholder; replace it only with an approved backup path. Do not run the template until the expected server address and an isolated disposable PostgreSQL service have been independently verified. For a read-only app smoke check, first confirm port 3001 is free (if occupied, stop and identify its owner—never terminate it), set `DATABASE_URL` to the disposable target URL, then run `npm run start -- --hostname 0.0.0.0 --port 3001` in the foreground. Do not run write-capable integration or E2E suites against a production or development restore.

## Current sandbox evidence — 2026-11-11

**Restore not run; environment blocked.** `DATABASE_URL` is unset; no listener is present on ports 3001 or 5433; `psql`, `pg_dump`, `pg_restore`, `postgres`, Docker, and Podman are unavailable; and no backup archive was found in the repository/workspace. No database or backup was opened, created, restored, or modified. This is a documented blocker, not restore evidence. A real verification still requires an approved backup, the isolated port-5433 PostgreSQL instance, and the matching client tools.

## Required before production recovery can be claimed

Approve the backup destination, encryption/key ownership, schedule, retention, monitoring/alerting, access policy, RPO/RTO, and restore ownership; implement and operationally test the backup job and restore automation; and repeat this workflow on a representative approved backup. A successful restore verification alone does not prove that scheduled backups, off-site retention, or production recovery objectives are met.
