# Scheduled backups, retention and failure reporting

**Status: implemented.** The one-shot scheduled runner, the retention pass and
the structured failure report are implemented and exercised in CI against real
PostgreSQL. Off-site storage, encryption/key ownership, monitoring dashboards
and restore automation are **not** implemented — they are Batch 3C, listed at
the end of this document.

This document is the companion to
[backup and restore verification](backup-restore-verification.md), which
describes how a backup is created and how a restore is proven. Nothing here
changes that tooling: the scheduled runner _invokes_ the verified
`scripts/backup/backup.mjs` command rather than reimplementing it.

---

## 1. The shape of the thing

There is **no scheduler in this repository**, and there is no long-running
process. The tooling is deliberately a _one-shot runner_:

```
platform scheduler  ──▶  scripts/backup/scheduled-backup.mjs  ──▶  exit code + result file
 (cron, Task Scheduler,      (one backup, one retention pass, then it exits)
  Kubernetes CronJob, …)
```

The platform owns the _frequency_. The runner owns the _safety_ of a single
invocation. That split is what keeps the tool deployment-neutral: no hosting
provider is assumed, no new dependency is introduced, and the same command
runs on a Linux host, on Windows and inside a container.

| File                                  | Purpose                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `scripts/backup/scheduled-backup.mjs` | The one-shot runner: lock → backup → retention → structured result → exit code.                                    |
| `scripts/backup/retention.mjs`        | The retention pass: classify every file in the backup directory, decide what may be deleted, and delete only that. |
| `scripts/backup/lib.mjs`              | Shared guardrails (Batch 3A) plus the two new exit codes (`6` locked, `7` storage).                                |

Both new files are dependency-free (Node built-ins only), exactly like the
Batch 3A scripts, so they run during a recovery before `npm ci`.

---

## 2. Running one scheduled backup

```bash
DATABASE_URL='postgresql://user:…@host:5432/agencyos' \
BACKUP_DIR=/srv/agencyos/backups \
BACKUP_RETENTION_COUNT=7 \
  node scripts/backup/scheduled-backup.mjs --label nightly
```

What it does, in order:

1. **Checks the destination.** The backup directory must exist (it is created
   if missing) and must be _writable_ — proven by writing a probe file, not
   by trusting a permission bit. If the storage is unavailable the run stops
   with exit code `7` and nothing is written or deleted.
2. **Takes the lock.** A lock file (`<dir>/.agencyos-backup.lock`) is created
   with `wx`. If another run already holds it, this run refuses with exit
   code `6` and touches nothing. A lock whose owner process is gone _and_
   which is older than `BACKUP_LOCK_STALE_SECONDS` (default 6 hours) is
   reclaimed, so a killed run cannot silently disable every future backup.
3. **Runs the existing backup command** as a child process:
   `node scripts/backup/backup.mjs --dir <dir> [--label <label>]`. The
   archive is still created atomically, validated and published exactly as
   Batch 3A guarantees — the runner adds nothing to that path.
4. **Applies retention** (§4), unless the backup failed.
5. **Writes the structured result** (§5) and delivers the optional webhook
   (§6).
6. **Releases the lock** and exits with the documented code (§3).

A run never resets, drops, truncates or restores into any database. It only
reads.

---

## 3. Configuration

Command-line options win over environment variables, which win over the
defaults.

| Option                     | Environment variable        | Default                       | Meaning                                                       |
| -------------------------- | --------------------------- | ----------------------------- | ------------------------------------------------------------- |
| `--dir <path>`             | `BACKUP_DIR`                | `./backups`                   | The backup directory. Every deletion happens inside it.       |
| `--label <text>`           | `BACKUP_LABEL`              | _(none)_                      | Free-form label recorded in the manifest. Never a secret.     |
| `--keep <n>`               | `BACKUP_RETENTION_COUNT`    | `7`                           | How many verified backups to keep. Must be ≥ 1.               |
| `--dry-run`                | —                           | off                           | Report the retention plan; delete nothing.                    |
| `--retention-only`         | —                           | off                           | Apply retention only; create no new backup.                   |
| `--result-file <p>`        | `BACKUP_RESULT_FILE`        | `<dir>/last-run.json`         | Where the structured result is written.                       |
| `--lock-file <p>`          | `BACKUP_LOCK_FILE`          | `<dir>/.agencyos-backup.lock` | The run lock.                                                 |
| `--lock-stale-seconds <n>` | `BACKUP_LOCK_STALE_SECONDS` | `21600` (6 h)                 | How old an abandoned lock may be before it is reclaimed.      |
| `--hook-url <url>`         | `BACKUP_HOOK_URL`           | _(none)_                      | Webhook (http/https) that receives the structured result.     |
| —                          | `BACKUP_HOOK_TOKEN`         | _(none)_                      | Bearer token for the webhook. Supplied by the secret manager. |

`DATABASE_URL` is required, except with `--retention-only`. The password
travels to `pg_dump` through `PGPASSWORD` in the child environment; it is
never on a command line, never in a log line and never in the result file.

### Exit codes

| Code | Meaning                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------- |
| `0`  | Success.                                                                                                  |
| `2`  | Usage or safety violation: unknown option, missing `DATABASE_URL`, unusable retention count, unsafe path. |
| `3`  | The backup command failed, or a retention deletion failed.                                                |
| `4`  | The produced archive failed its integrity check (from the backup command).                                |
| `5`  | The produced archive failed verification (from the backup command).                                       |
| `6`  | Another run holds the lock. This run was refused; nothing was written or deleted.                         |
| `7`  | The destination storage is missing or not writable.                                                       |

These extend the Batch 3A vocabulary in `scripts/backup/lib.mjs` (`2` unsafe,
`3` tool failed, `4` integrity, `5` verification) so a single scheduler can
branch on the failure class.

---

## 4. Retention

```bash
node scripts/backup/scheduled-backup.mjs --retention-only --keep 14 --dry-run
```

Retention is **count-based**: the newest `N` verified backups are kept, and
older ones are expired. `N` comes from `--keep` or `BACKUP_RETENTION_COUNT`
and must be at least 1.

### What counts as a backup this tooling may delete

A file is eligible only when **all** of these hold:

| Check                                                              | Refusal reason reported         |
| ------------------------------------------------------------------ | ------------------------------- |
| The name is `agencyos-<timestamp>.dump`                            | `unrelated`                     |
| A sibling `<name>.dump.json` manifest exists                       | `no_manifest`                   |
| The manifest parses and its `archive` field is the file's own name | `manifest_mismatch`             |
| The manifest's `format` is `pg_dump custom`                        | `unexpected_format`             |
| The manifest records a well-formed SHA-256                         | `missing_checksum`              |
| The manifest's byte size equals the file's actual size             | `size_mismatch`                 |
| The archive is a regular file, not a symlink                       | `symlink`, `not_a_regular_file` |

A file that fails any check is **reported and left alone**. It is never
deleted "because it looks like a backup".

### The five guarantees

1. **Only inside the configured directory.** Every candidate is re-checked at
   deletion time: the path must be lexically inside the backup directory, and
   its _real_ path (symlinks resolved) must still be inside it. A symlinked
   parent directory cannot redirect a deletion out of the backup directory.
2. **Never an unrelated file.** Only archives matching the naming convention
   _and_ carrying a valid manifest are candidates. Operator notes, exports,
   the result file, the lock file and anything else in the directory are
   counted as unrelated and left untouched.
3. **Never the newest verified backup.** The newest verified archive is
   excluded from the delete set explicitly, whatever the policy says. A
   retention policy that can remove the last known-good backup is a policy
   that can leave the operator with nothing.
4. **Never a backup that is being written.** `backup.mjs` writes
   `<name>.partial-<pid>-<rand>` and renames it into place only after the
   archive validates, so an in-flight backup has no final name. Partial files
   are listed and never touched, and an archive whose manifest has not been
   written yet is not eligible either.
5. **Never after a failed backup.** If the backup in this run failed, the
   retention pass is skipped (`retention.reason = "backup_failed"`): the
   previous archives are then the only known-good history. The same rule
   applies to a separate `--retention-only` schedule, which reads the last
   run's result and refuses to prune while the last backup failed
   (`retention.reason = "latest_backup_failed"`).

### Dry run

`--dry-run` performs everything except the deletions: the backup still runs,
the plan is computed, and `retention.planned` lists exactly what _would_ be
removed. Nothing on disk changes. Use it to validate a new policy before
letting it run unattended.

---

## 5. The structured result

Every run writes a JSON document (default `<dir>/last-run.json`, mode `0600`)
and prints the same document as a single line:

```
[scheduled-backup] RESULT {"tool":"agencyos-scheduled-backup","schemaVersion":1,…}
```

```jsonc
{
  "tool": "agencyos-scheduled-backup",
  "schemaVersion": 1,
  "runId": "0f0f…",
  "status": "succeeded", // succeeded | failed | skipped
  "startedAt": "2026-11-12T02:00:00.000Z",
  "finishedAt": "2026-11-12T02:00:14.512Z",
  "durationMs": 14512,
  "directory": "/srv/agencyos/backups",
  "source": { "host": "db.internal", "port": "5432", "database": "agencyos" },
  "backup": {
    "status": "succeeded", // succeeded | failed | skipped | not-run
    "lastStatus": "succeeded", // status of the most recent backup attempt known to the runner
    "exitCode": 0,
    "durationMs": 13880,
    "archive": {
      "name": "agencyos-2026-11-12T02-00-00-000Z.dump",
      "path": "/srv/agencyos/backups/agencyos-2026-11-12T02-00-00-000Z.dump",
      "bytes": 8123456,
      "sha256": "9f2c…",
      "manifestPath": "/srv/agencyos/backups/agencyos-2026-11-12T02-00-00-000Z.dump.json",
    },
    "manifestPath": "…",
    "reason": null,
  },
  "retention": {
    "status": "applied", // applied | dry-run | skipped | not-run
    "reason": null,
    "policy": { "keep": 7, "dryRun": false, "directory": "…", "mode": "backup-and-retention" },
    "scanned": 9,
    "kept": ["agencyos-…dump", "…"],
    "deleted": ["agencyos-…dump"],
    "planned": [],
    "skipped": [{ "name": "agencyos-…dump", "reason": "symlink" }],
    "warnings": [],
    "unrelated": 2,
    "partials": 0,
  },
  "lock": { "path": "…", "acquired": true, "reclaimed": false },
  "hook": { "status": "sent", "url": "https://…", "httpStatus": 200, "error": null },
  "error": null, // { code, message, exitCode } when the run failed
}
```

The result contains **no credentials**: no password, no user, no unredacted
connection URL. The source is described by host, port and database only, and
error messages are redacted and truncated.

---

## 6. Failure reporting

Three mechanisms, none of which requires a paid service.

### 6.1 Exit codes

The scheduler sees the exit code (§3). Anything other than `0` is a failure
worth alerting on; `2`, `3`, `6` and `7` are distinguishable, so "the disk is
full" is not reported as "the database is unreachable".

### 6.2 The result file

`last-run.json` holds the last run's status, so a monitor can read one file
and decide. It is rewritten atomically (`0600`), so it is never a half-written
document.

### 6.3 The webhook hook

Set `BACKUP_HOOK_URL` (and optionally `BACKUP_HOOK_TOKEN`) and the runner
`POST`s the result document as JSON to that URL:

```
POST /hooks/backups
Authorization: Bearer <BACKUP_HOOK_TOKEN>
Content-Type: application/json

{ "tool": "agencyos-scheduled-backup", "status": "failed", "error": { … } }
```

Any HTTP endpoint works — a webhook receiver, a CI dispatch endpoint, a
self-hosted ntfy/Gotify instance, a script on the host. The request has a
10-second timeout; a failing or unreachable hook is recorded in
`hook.status` and in `hook.error` but does **not** change the run's exit
code, so a broken notification endpoint cannot turn a good backup into a
failed one (or hide a real failure).

The token is sent as a bearer header and is never written to the log or to
the result file. The webhook URL is logged with its userinfo, query string
and fragment removed.

---

## 7. Scheduling

Pick whichever the platform already provides. The command is identical in
all three.

### 7.1 Linux cron

```cron
# /etc/cron.d/agencyos-backup
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 02:15 every day. Secrets come from a root-only environment file, never
# from the crontab itself.
15 2 * * * agencyos-backup
```

with `/usr/local/bin/agencyos-backup`:

```sh
#!/bin/sh
set -eu
# /etc/agencyos/backup.env is mode 0600, owned by root, and holds
# DATABASE_URL and any hook credentials.
set -a
. /etc/agencyos/backup.env
set +a
exec /usr/bin/node /srv/agencyos/scripts/backup/scheduled-backup.mjs \
  --dir /srv/agencyos/backups --keep 14 --label cron \
  >> /var/log/agencyos-backup.log 2>&1
```

The runner has its own lock, so a run that overruns its slot makes the next
one exit `6` instead of two backups writing to the same directory. `flock`
may be added on top (`flock -n /var/lock/agencyos-backup.lock …`) if the
host runs other backup tooling, but it is not required.

### 7.2 Windows Task Scheduler

The script is `scheduled-backup.cmd`, kept outside the repository, with the
secrets read from the machine's secret store at run time:

```bat
@echo off
REM Credentials come from the approved secret manager; never from this file.
call "%ProgramFiles%\AgencyOS\load-secrets.cmd"
"C:\Program Files\nodejs\node.exe" "C:\agencyos\scripts\backup\scheduled-backup.mjs" --dir "D:\agencyos-backups" --keep 14 --label task-scheduler
exit /b %ERRORLEVEL%
```

Register it (run as an elevated prompt):

```bat
schtasks /create /tn "AgencyOS Backup" ^
  /tr "C:\agencyos\scheduled-backup.cmd" ^
  /sc daily /st 02:15 ^
  /ru "NT AUTHORITY\SYSTEM" /rl HIGHEST /f
```

`%ERRORLEVEL%` carries the runner's exit code into the Task Scheduler's last
run result, so a failed backup is visible without reading a log.

### 7.3 Container-based deployment

The image is a one-shot job. `Dockerfile.backup` contains Node, the
PostgreSQL 16 client tools and the backup scripts — nothing else, and no
credentials.

```bash
docker build -f Dockerfile.backup -t agencyos-backup:local .
```

With the Compose profile (the service is not part of `docker compose up`):

```bash
BACKUP_HOST_DIR=/srv/agencyos/backups \
  docker compose --profile backup run --rm backup
```

As a Kubernetes CronJob:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: agencyos-backup
spec:
  schedule: '15 2 * * *'
  concurrencyPolicy: Forbid # the runner's own lock is the second line of defence
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: agencyos-backup:local
              args: ['--dir', '/backups', '--keep', '14', '--label', 'cronjob']
              env:
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef: { name: agencyos-db, key: database-url }
                - name: BACKUP_RETENTION_COUNT
                  value: '14'
              volumeMounts:
                - { name: backups, mountPath: /backups }
          volumes:
            - name: backups
              persistentVolumeClaim: { claimName: agencyos-backups }
```

The same pattern works on any container platform with a scheduled-job
feature (Cloud Scheduler, ECS scheduled task, Nomad periodic job) and on a
CI scheduler (`schedule:` in GitHub Actions). Whatever the platform, the
command inside the container is the same.

---

## 8. Security safeguards

| Safeguard                                                                | Where                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| No database resets, drops, truncates or restores — the runner only reads | the runner never connects to a database itself; `backup.mjs` uses `pg_dump` only                        |
| No credentials in logs, results or process arguments                     | `PGPASSWORD` in the child environment; `redactUrl` for the DSN; `redactCredentials` on every message    |
| No path traversal                                                        | every deletion is re-checked against the configured directory, lexically _and_ by real path             |
| No symlink following                                                     | symlinked archives are refused; a candidate must still be a regular file at deletion time               |
| No directory escape                                                      | the resolved real path of a candidate must remain inside the resolved real path of the backup directory |
| No overlapping runs                                                      | exclusive lock file; a live lock refuses the second run with exit `6`                                   |
| Atomic archive creation                                                  | unchanged from Batch 3A: the dump is validated before it is renamed into place                          |
| Fail safely when storage is unavailable                                  | the destination is proven writable before anything is written or deleted; exit `7`                      |
| No deletion after a failed backup                                        | retention is skipped when the backup failed, and when the last recorded backup failed                   |
| The newest verified backup is never deleted                              | explicit exclusion in the retention plan                                                                |
| Restore verification still works                                         | untouched; `scripts/backup/verify-restore.mjs` and its CI job are unchanged                             |

---

## 9. Operational notes

- **Check a run.** `cat /srv/agencyos/backups/last-run.json`, or read the
  `RESULT` line in the scheduler's log. `status: "succeeded"` plus a
  `sha256` means an archive was created and validated.
- **Restore from a retained backup.** The retention pass keeps whole
  archives with their manifests, so the documented restore procedure
  ([backup-restore-verification.md](backup-restore-verification.md)) applies
  unchanged to any retained archive.
- **Changing the policy.** Test it first: `--retention-only --keep N
--dry-run` prints `retention.planned` without touching anything.
- **The backup directory is not a backup.** It lives on the same host as the
  database. Off-site replication is Batch 3C.

---

## 10. Not implemented (Batch 3C)

Deliberately out of scope for this batch, and still required before a
production recovery claim:

- Off-site replication of archives, and a documented RPO/RTO.
- Encryption at rest and key ownership for the backup volume.
- Monitoring of backup _age_ (not just failure), dashboards and alerting
  beyond the exit code, the result file and the webhook.
- Automated restore drills on a schedule, and a named owner for them.
- Approval of the data owner before verifying against real production data.
- A decision on whether the CI job's second PostgreSQL service should be
  replaced by the real isolated environment for drill runs.

A green scheduled run proves that an archive was created and validated. It
does not prove that the archive is recoverable from another site, and it does
not prove the retention window is long enough.
