# Off-site Shipping and Backup Inventory — Phase 4D / Batch 3C-2B

## Scope and status

This batch adds one S3-compatible shipping adapter for the encrypted replicas produced by [encrypted replication](./backup-encrypted-replication.md), a hash-chained inventory, and recovery from the bucket through the existing [isolated restore verifier](./backup-restore-verification.md). It adds no dependency and changes no existing backup, encryption, restore, scheduling or retention behavior.

**It is not active anywhere by default** and is not wired into `docker-compose.yml`. It has been verified against an in-process test double and against an isolated MinIO server in CI. **It has not been verified against a real provider account**: no provider, bucket, credentials, retention policy or key custody have been chosen. Treat a real off-site recovery capability as pending until the items under [Remaining production configuration](#remaining-production-configuration) are complete.

| File                                           | Purpose                                              |
| ---------------------------------------------- | ---------------------------------------------------- |
| `scripts/backup/shipping.mjs`                  | Adapter, inventory, ship / verify / recover          |
| `scripts/backup/ship.mjs`                      | Command line (`npm run db:backup:ship -- <action>`)  |
| `scripts/backup/scheduled-backup.mjs`          | Opt-in shipping step after replication               |
| `lib/__tests__/backup/backup-shipping.test.ts` | Failure-path tests                                   |
| `.github/workflows/ci.yml` (`backup-verify`)   | End-to-end run against MinIO and isolated PostgreSQL |

## How shipping works

Only `<archive>.age` files in `BACKUP_REPLICATION_DIR` are shipped. The shipper does not load the replication key and never opens a plaintext archive; a file that does not begin with the age passphrase header is refused before any network request.

For each object the adapter:

1. Hashes the local ciphertext (SHA-256) and checks the inventory. A backup identifier already recorded with a different hash, key, size or key version is refused.
2. Requests the object key. If it exists, the object is downloaded and compared: identical content is an idempotent success (`already-present`), different content is refused. **Nothing is ever replaced.**
3. Otherwise uploads with `If-None-Match: *` (create-only) and a signed `x-amz-content-sha256`, so the provider can reject a body damaged in transit.
4. Downloads the object again and compares size and SHA-256 with the local ciphertext.
5. Appends a `verified` entry to the inventory. A content mismatch appends `failed` instead.

Network errors, HTTP 5xx, 408 and 429 are retried with backoff (`BACKUP_SHIPPING_ATTEMPTS`, default 3). Every attempt restarts at step 2, so an upload whose response was lost is recognized rather than repeated. Permission and validation errors are not retried.

Transport is HTTPS only: `http://` endpoints are rejected, redirects are not followed, and certificate verification cannot be disabled. `BACKUP_SHIPPING_CA_FILE` may add a private CA; it cannot remove checks.

Limits, stated plainly:

- **Single-request upload only.** Replicas above 5 GiB are refused; multipart upload is not implemented.
- **Path-style addressing** (`https://endpoint/bucket/key`) and SigV4 only.
- **Overwrite protection depends on the provider.** The look-before-write check is not atomic. `If-None-Match: *` closes that gap only where the provider implements conditional writes; a provider that ignores the header leaves a narrow race between two writers of the same key. Neither stops another identity, or the provider, from replacing or deleting an object. Only provider-enforced versioning or object lock does, and this tool does not assume, configure or verify either.
- A retry re-downloads an existing object to compare it, which costs bandwidth for large replicas.

## Configuration

All values come from the environment, injected by the scheduler's secret store. Nothing is read from Git, and missing or malformed values fail closed.

| Variable                            | Meaning                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `BACKUP_SHIPPING_ENDPOINT`          | Bare `https://` origin of the S3-compatible API. Setting it opts the scheduled run in. |
| `BACKUP_SHIPPING_REGION`            | Signing region                                                                         |
| `BACKUP_SHIPPING_BUCKET`            | Existing bucket. The tool never creates buckets.                                       |
| `BACKUP_SHIPPING_PREFIX`            | Optional key prefix (`[A-Za-z0-9._-]` segments)                                        |
| `BACKUP_SHIPPING_ACCESS_KEY_ID`     | Shipping identity                                                                      |
| `BACKUP_SHIPPING_SECRET_ACCESS_KEY` | Shipping secret                                                                        |
| `BACKUP_SHIPPING_SESSION_TOKEN`     | Optional, for temporary credentials                                                    |
| `BACKUP_SHIPPING_INVENTORY`         | Absolute path of the inventory file, in an existing directory owned by the job, `0700` |
| `BACKUP_SHIPPING_CA_FILE`           | Optional additional CA certificate (absolute path)                                     |
| `BACKUP_SHIPPING_ATTEMPTS`          | Optional, 1–10, default 3                                                              |
| `BACKUP_REPLICATION_KEY_ID`         | Non-secret label of the replication key version in use, e.g. `k2026-11`                |
| `BACKUP_REPLICATION_DIR`            | Existing replica directory (see the replication runbook)                               |

Credential handling: credentials are held in a non-enumerable field, are stripped from the environment of the `pg_dump` and restore-verifier child processes, and are never written to logs, the result file or the inventory. Provider error bodies are never printed (they can echo the access key id); only the HTTP status and the provider's error code are reported. Keep the inventory directory outside the backup and replica directories.

### Shipping identity

Grant the shipping identity exactly, on this bucket/prefix only:

- `s3:PutObject`
- `s3:GetObject` (read-back verification and recovery)
- `s3:ListBucket` (without it most providers answer `403` instead of `404` for a missing key, and shipping fails closed)

Do **not** grant `s3:DeleteObject`, `s3:PutBucket*`, lifecycle, versioning or object-lock administration. The code issues only `GET` and `PUT`. Expiry of old objects belongs to a provider lifecycle rule managed by a different identity. Note that `s3:PutObject` alone allows overwriting on most providers; refusing to overwrite is this tool's behavior, not a property of the permission. Prefer a separate read-only identity for recovery drills.

## Operation

Scheduled runs: when `BACKUP_SHIPPING_ENDPOINT` is set, the runner ships the new replica after encrypted replication succeeds, still under the backup lock. The result file gains a `shipping` block (`status`, `object`, `sha256`, `inventoryHead`). If shipping fails, the run exits 3 with `shipping_failed`, **retention is skipped and no local archive or replica is removed**; a later `--retention-only` run also refuses to prune (`latest_shipping_failed`) until a run ships successfully. Shipping configured without encrypted replication fails and uploads nothing.

Manual use (the same environment is required):

```sh
# Ship or retry one replica. Safe to repeat.
node scripts/backup/ship.mjs ship --name agencyos-EXAMPLE.dump

# Re-download and compare with the inventory (records the outcome if it changed).
node scripts/backup/ship.mjs verify --name agencyos-EXAMPLE.dump

# Check the inventory chain; with --anchor, prove a previously recorded head is still in it.
node scripts/backup/ship.mjs inventory
node scripts/backup/ship.mjs inventory --anchor <head-hash-recorded-elsewhere>
```

Exit codes: `0` success, `4` integrity mismatch (remote object differs from the local replica or the inventory), `3` any other failure. Messages are generic by design.

## Inventory

`BACKUP_SHIPPING_INVENTORY` is an append-only JSON-lines file. Each entry holds:

| Field        | Content                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `seq`        | 1-based position                                                                         |
| `backupId`   | Archive name                                                                             |
| `sha256`     | SHA-256 of the ciphertext                                                                |
| `objectKey`  | Key in the bucket                                                                        |
| `bytes`      | Ciphertext size                                                                          |
| `createdAt`  | Modification time of the encrypted replica file (filesystem metadata, not authenticated) |
| `keyId`      | `BACKUP_REPLICATION_KEY_ID` at shipping time (operator-supplied label, not derived)      |
| `status`     | `verified` or `failed` — outcome of the most recent download comparison                  |
| `recordedAt` | When the entry was appended                                                              |
| `prev`       | Hash of the previous entry (64 zeros for the first)                                      |
| `hash`       | SHA-256 over all fields above                                                            |

The tool only appends. Existing lines are never rewritten, a backup identifier can never be re-bound to different ciphertext, object key, size or key version, and a status change is a new entry. Every read re-verifies the whole chain: an edited, removed, reordered or partially written line makes all shipping commands fail closed until an operator investigates. A `.lock` file serializes writers; a crash can leave it behind, and it must be removed by hand only when no run is active.

### What the inventory does not prove

**The local inventory is advisory.** The chain uses plain hashes, not a secret or signature, so anyone who can write the file — root, the job user, an attacker on the host — can rebuild a complete, internally consistent chain, or drop the newest entries. It is tamper-_evident_ only relative to a head hash kept somewhere that person cannot change. It is **not tamper-proof and must not be described as such.**

To make it meaningful, record the head hash (`inventory.head` in command output, `shipping.inventoryHead` in the scheduled result, which the existing `BACKUP_HOOK_URL` webhook already delivers) in a system outside both the source host and the storage account — for example the monitoring system or a ticket. `inventory --anchor <hash>` then confirms that the anchored history is still a prefix of the current file. Choosing, operating and monitoring that anchor is a deployment requirement outside this batch. The inventory is also not stored in the bucket: doing so would put it in the same account as the objects it describes.

`keyId` is a label typed by an operator. A wrong label is caught at recovery only indirectly (decryption fails). The key itself is never stored or hashed into the inventory.

## Recovery verification

```sh
# /srv/recovery-tmp: existing, empty, 0700, on encrypted ephemeral storage,
# separate from the backup, replica, key and inventory locations.
# Environment: shipping variables above, exactly one replication key source,
# BACKUP_REPLICATION_KEY_ID matching the inventory entry, and the
# RESTORE_VERIFY_* / DATABASE_URL values from backup-restore-verification.md.
node scripts/backup/ship.mjs recover --name agencyos-EXAMPLE.dump \
  --temp-dir /srv/recovery-tmp --verify-restore
```

The command works without the local replica and performs, in order:

1. **Remote integrity against the inventory** — the object is streamed into a fresh `0700` subdirectory (`agencyos-shipped-*`), capped at the recorded size, and its SHA-256 must equal the inventory entry. A missing, truncated, extended or altered object stops here with exit 4.
2. **Authenticated decryption with the right key** — the entry's `keyId` must equal `BACKUP_REPLICATION_KEY_ID`, then the existing `recover()` authenticates the age ciphertext. A wrong key fails.
3. **Original manifest and archive checksum** — the existing code validates the embedded manifest, size and SHA-256 of the dump.
4. **Isolated PostgreSQL restore** — with `--verify-restore`, the existing `verify-restore.mjs` runs unchanged, with all of its guards: confirmation string, `agencyos_restore_verify_` prefix, refusal of the `DATABASE_URL` database, approved port. It creates and drops its own disposable database. Without the flag the result is `integrity-verified`, which is not a restore test.

The verifier child process receives neither the replication key nor storage credentials. Ciphertext and plaintext are removed in `finally` on success and on every failure. As with local recovery, an abrupt kill can leave an `agencyos-shipped-*` directory behind, and file deletion is not secure erasure — use encrypted ephemeral storage. **Never point the verifier at an active development or production database.**

## Verification evidence

- Unit tests (`lib/__tests__/backup/backup-shipping.test.ts`) use a TLS test double with injected provider failures: successful shipping, failed upload, transient failure and lost-response retries, overwrite refusal (pre-existing object and lost race), corruption at upload time and afterwards, wrong key and wrong key version, inventory edits/removal/reordering/truncation, unsafe paths and symlinks, and the scheduled runner keeping local backups when shipping fails. The SigV4 signature is compared with a value produced independently by botocore.
- CI (`backup-verify`) runs the real command line against MinIO over TLS with throwaway credentials: ship, retry, byte-for-byte comparison through a separate client, the store's own conditional-write refusal, inventory anchor check, recovery from the bucket alone into the isolated PostgreSQL service on port 5433, wrong key, tampered object, and a scan of all output for the storage credential.

MinIO in CI uses its root account, so **least-privilege enforcement, provider-specific conditional-write behavior, versioning/object lock and lifecycle rules are untested**.

## Remaining production configuration

Separate requirements, none of which this batch decides or implements:

1. **Provider and bucket**: choose a provider and failure domain independent of the source host; confirm it supports `If-None-Match: *` on `PutObject` and path-style addressing; run the full ship → verify → recover drill against the real account.
2. **Immutability and retention**: decide and enable versioning and/or object lock with a retention period, and lifecycle expiry under a different identity. Until then a storage-side overwrite or deletion is detected only at the next `verify`/`recover`, not prevented.
3. **Identity and network**: create the least-privilege shipping identity above and a separate recovery identity; decide credential rotation and injection; restrict egress.
4. **Key custody**: ownership, escrow and rotation of replication keys, and a controlled registry of `BACKUP_REPLICATION_KEY_ID` values. Old keys must be retained while any object encrypted with them must be recoverable.
5. **Inventory anchoring**: an independent destination for the head hash, a backup of the inventory file itself, and a routine `inventory --anchor` check.
6. **Monitoring**: alerting on `shipping_failed`, on backup age, on periodic `verify` failures, and scheduled recovery drills with recorded RPO/RTO.
7. **Large databases**: multipart upload if encrypted replicas can exceed 5 GiB.
