# Backup and restore verification

**Status: backup creation and isolated restore verification are implemented, and are exercised end to end on real PostgreSQL in CI (`backup-verify` job). Scheduling, retention, off-site storage, encryption/key management, monitoring and restore automation are NOT implemented — they are Batch 3B work, listed at the end of this document.**

This document covers three things: the safety invariants that any restore must satisfy, the tooling that implements backup + verification, and the residual work required before a production recovery claim is possible.

## Safety invariants

- Never reset, drop, truncate, overwrite, or restore into the development database. The tooling enforces this (see _Guards_); it is not a convention.
- Restore only into a **newly created, uniquely named, disposable** database prefixed `agencyos_restore_verify_`. Never reuse an existing database, and never point a restore at the development Compose database or copy its `DATABASE_URL`.
- The isolated restore target uses the reserved port **5433**; the application (if a smoke check is needed) uses **3001**. If 5433 is occupied by a development database, stop and provision a separate isolated environment — do not connect to, stop, or remap over it. Never use port 3000 or the separate Codex project.
- No `pg_restore --clean`, `dropdb`, `prisma db push`, or `prisma migrate dev` in verification. The verifier drops only the database it created in the same run, and only after re-checking its prefix.
- Credentials travel in environment variables (`PG*`), never on a command line, and never appear in logs, tickets or this document.
- Use a synthetic/sanitized backup for verification runs unless the data owner has approved the real one.

## Tooling

| File                                             | Purpose                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/backup/backup.mjs`                      | Creates a consistent custom-format dump, validates it, publishes it with a `.json` manifest.                                                                |
| `scripts/backup/verify-restore.mjs`              | Restores a dump into a new disposable database and verifies schema, tables, row counts, migrations and referential integrity.                               |
| `scripts/backup/lib.mjs`                         | Shared guardrails: connection parsing/redaction, libpq env, exclusive file creation, checksums, path containment, disposable-target assertions.             |
| `scripts/backup/ci-seed.sql`                     | Small known fixture (organization → user → session, plus a role and rate-limit rows) used by CI to prove real rows survive.                                 |
| `lib/__tests__/backup/backup-guardrails.test.ts` | Unit tests for the guardrails and the CLI surface.                                                                                                          |
| `.github/workflows/ci.yml` → `backup-verify`     | The end-to-end job: back up, refuse overwrite, restore into an isolated second PostgreSQL service, verify rows independently, then prove the failure paths. |

Both scripts are dependency-free (Node built-ins only) so they can run during a recovery, before `npm ci`.

### Creating a backup

```bash
DATABASE_URL='postgresql://user:...@host:5432/agencyos' \
  node scripts/backup/backup.mjs --dir backups --label nightly
```

Produces `backups/agencyos-<timestamp>.dump` plus `backups/agencyos-<timestamp>.dump.json`. The manifest records the SHA-256, byte size, source host/port/database (never the user or password), PostgreSQL version, applied migration count, and exact per-table row counts.

What the script guarantees, in order:

1. **No overwrite.** The output is opened with `wx`. An existing path is exit code `2` unless `--force-replace` is passed deliberately. Run against the same `--output` twice, the second run fails and the first archive is untouched.
2. **A consistent snapshot.** `pg_dump --serializable-deferrable` inside one transaction, so the archive is a single point-in-time state even while the application writes.
3. **No bad archive under a good name.** The dump is written to `<name>.partial-<pid>-<rand>`, then validated (`pg_restore --list` succeeds, the file is plausibly sized, at least one `TABLE DATA` entry exists) and only then renamed into place. Any failure deletes the partial and exits non-zero.
4. **No credentials in output.** Only file names, sizes, checksums and counts are printed. The DSN is printed redacted (`user:***@host`).
5. **Owner-only files.** `0600` archives and manifests in a `0700` directory.

Exit codes: `0` ok, `2` unsafe/usage (including refusing to overwrite), `3` a PostgreSQL client failed, `4` integrity failure, `5` verification failure.

### Verifying a restore

```bash
RESTORE_VERIFY_ADMIN_URL='postgresql://user:...@isolated-host:5433/postgres' \
RESTORE_VERIFY_ISOLATION_CONFIRMATION=I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET \
RESTORE_VERIFY_ALLOWED_PORT=5433 \
  node scripts/backup/verify-restore.mjs --backup backups/agencyos-<timestamp>.dump
```

`RESTORE_VERIFY_ADMIN_URL` must name a **maintenance** database (`postgres`) on the isolated instance. The script creates `agencyos_restore_verify_<timestamp>_<random>`, restores into it, verifies, and drops only that database.

### Guards

All of these run before the first write:

| Guard                                                                                           | Failure mode prevented                                                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `RESTORE_VERIFY_ISOLATION_CONFIRMATION` must equal `I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET`   | Verifying against an environment nobody deliberately designated as disposable.                             |
| Target name must start with `agencyos_restore_verify_`                                          | Restoring over a real database.                                                                            |
| Target host+port+database must not equal `DATABASE_URL`                                         | Restoring over the application's own database. Checked first, so the error names the serious problem.      |
| `RESTORE_VERIFY_ALLOWED_PORT` (e.g. `5433`)                                                     | Silently verifying against the wrong server.                                                               |
| `RESTORE_VERIFY_EXPECTED_SERVER_ADDRESS`, checked against `inet_server_addr()` after connecting | A URL that resolves somewhere other than the approved host.                                                |
| Manifest must exist; archive SHA-256 must match it                                              | Verifying a truncated, swapped or corrupted archive.                                                       |
| Target must not already exist (re-checked immediately before `CREATE DATABASE`)                 | Reusing, and therefore partially overwriting, an old verification database.                                |
| `pg_restore --exit-on-error --single-transaction`                                               | A _partially_ restored database being reported as a good restore. Any error rolls the entire restore back. |

`assertWithinRoots` additionally refuses a `--output` outside the backup directory, so a typo cannot write over an unrelated file.

### What the verification actually asserts

Restoring a syntactically valid archive proves nothing on its own — an archive containing no data restores "successfully". The verifier fails unless all of the following hold, measured against the restored database:

1. **Schema present** — all critical tables exist (`User`, `Organization`, `Role`, `Permission`, `Session`, `Invitation`, `Contact`, `AgencyAccount`, `Pipeline`, `Opportunity`, `Invoice`, `Payment`, `Project`, `Task`, `Document`, `ClientAccess`, `ClientInvitation`, `RateLimitBucket`).
2. **Migration history present** — `_prisma_migrations` has at least one applied migration.
3. **Referential integrity** — no foreign-key constraint is left unvalidated (`pg_constraint.convalidated`) and no index is left invalid. A restore that skipped constraints cannot pass this.
4. **Rows are physically there** — exact `count(*)` per table, compared to the manifest. `pg_stat_user_tables.n_live_tup` is deliberately not used: it is a planner estimate that reads `0` in a freshly restored database, so an estimate-based check would pass on an empty restore.
5. **Nothing shrank** — any table that held rows in the source must hold at least as many after restore. (More is allowed: a live source keeps writing after the snapshot.) A restore that silently dropped rows fails here.
6. **Not empty** — a restore with zero rows everywhere fails unless `--allow-empty-tables` is passed for a deliberately empty source.

The successful run prints a single machine-readable evidence line: `[verify] OK {"label":...,"sha256":...,"schemaTables":...,"totalRows":...,"appliedMigrations":...,...}`.

## CI evidence

The `backup-verify` job in `.github/workflows/ci.yml` runs on real PostgreSQL, not mocks:

- Two separate `postgres:16-alpine` services: the source on `5432` and an **isolated restore target** on `5433`. Because they are different containers, a bug that wrote to the wrong database could not pass unnoticed.
- Migrate the source, then insert the `ci-seed.sql` fixture.
- Run `backup.mjs` and print the manifest.
- Re-run `backup.mjs` against the existing archive and assert **exit 2** — the anti-clobber guarantee on a real filesystem.
- Run `verify-restore.mjs` against the isolated target with the confirmation string and port pin.
- **Independently** query the restored rows with `psql` and compare them to the expected fixture — the verifier is not allowed to be the only witness to its own success.
- Corrupt a copy of the archive and assert **exit 4** with a checksum-mismatch message.
- Assert **exit 2** for a missing confirmation, for a target named after the application database, and for the wrong isolated port.
- Confirm the source database still has its data after all of the refusal attempts.
- Grep every log and manifest for password material and unredacted URLs; fail if any is found.
- Upload the manifest and verification log as a build artifact.

A mocked or unit-tested backup script cannot satisfy this requirement, which is why the real restore lives in a dedicated CI job rather than in the unit suite. The unit suite covers the guard rules, redaction, exclusive creation, path containment and checksums.

## Manual restore template (Windows PowerShell)

Use this when a restore must be demonstrated outside CI, for example on an approved production backup. Use a fresh PowerShell session. Provision the URLs from the approved secret manager as process-scoped values; do not paste credentials into a command or print them.

```powershell
$ErrorActionPreference = 'Stop'
if ($env:RESTORE_VERIFY_ISOLATION_CONFIRMATION -ne 'I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET') {
  throw 'First verify out of band that this is a NEW disposable isolated PostgreSQL instance; then set the confirmation value in this session.'
}
if (-not $env:RESTORE_VERIFY_ADMIN_URL -or -not $env:RESTORE_VERIFY_EXPECTED_SERVER_ADDRESS) {
  throw 'Provide the isolated restore URL and expected server address through the approved secret manager.'
}

$adminUri = [Uri]$env:RESTORE_VERIFY_ADMIN_URL
if ($adminUri.Scheme -notin @('postgres', 'postgresql')) { throw 'The URL must use the postgres or postgresql scheme.' }
$adminDb = [Uri]::UnescapeDataString($adminUri.AbsolutePath.TrimStart('/'))
if ($adminUri.Port -ne 5433) { throw 'The isolated PostgreSQL URL must use port 5433.' }
if ($adminDb -notmatch '^[A-Za-z0-9_]+$') { throw 'The URL must name a simple maintenance database.' }

$listener = Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue
if (-not $listener) { throw 'No PostgreSQL listener on the reserved port 5433; provision the isolated target first.' }

# Configure libpq from the secret URL without putting credentials on a command line.
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

# The verification script performs the identity check, the prefix check, the
# existence check, the restore and the data checks itself.
node scripts/backup/verify-restore.mjs --backup 'C:\path\to\approved\backup.dump' --keep
if ($LASTEXITCODE -ne 0) { throw "Restore verification failed with exit code $LASTEXITCODE; preserve the disposable target and logs." }
```

`--keep` leaves the disposable database in place for inspection; drop it manually only after confirming its name carries the `agencyos_restore_verify_` prefix. For a read-only application smoke check, first confirm port 3001 is free (if occupied, stop and identify its owner — never terminate it), set `DATABASE_URL` to the disposable target URL, then run `npm run start -- --hostname 0.0.0.0 --port 3001` in the foreground. Do not run write-capable integration or E2E suites against a production or development restore.

## Required before a production recovery claim (Batch 3B)

Deliberately out of scope for this batch, and still required:

- An approved backup destination with encryption and key ownership (no backup is uploaded anywhere today; archives land on local disk).
- A schedule and retention policy, plus pruning that never deletes the newest verified backup.
- Monitoring and alerting on backup failure, age, and verification failure.
- Off-site replication and a documented RPO/RTO.
- Restore automation and an owner for periodic restore drills.
- Approval of the data owner before verifying against real production data, and a documented sanitization approach if synthetic data is used instead.
- A decision on whether the CI job's second PostgreSQL service should be replaced by the real isolated environment for drill runs.

A successful restore verification does not prove that scheduled backups, retention or recovery objectives are met.
