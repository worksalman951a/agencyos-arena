# Encrypted backup replication (Batch 3C-1)

This opt-in layer complements, not replaces, [backup and isolated restore verification](backup-restore-verification.md) and [scheduling and retention](backup-scheduling-retention.md). The filesystem adapter is a **reference/development adapter**, not off-site disaster recovery by itself. An independent off-host mount, its operational guarantees, and tested key recovery are prerequisites for any off-site recovery claim.

## Security and configuration

- Node 22 and `npm ci --omit=dev` (or the updated backup image), plus compatible PostgreSQL client tools including `pg_restore`, are required. The age-encryption dependency implements the standard **age passphrase file format**, using authenticated encryption and scrypt. The encrypted payload contains a four-byte manifest length, the exact original JSON manifest, and the original dump. This is payload framing, not a new encryption format. No plaintext archive or manifest is uploaded.
- Generate a **unique, uniformly random 32-byte key** with a trusted secret manager. Provision its 64 lowercase hexadecimal characters as exactly one of `BACKUP_REPLICATION_KEY` (environment secret) or `BACKUP_REPLICATION_KEY_FILE` (absolute path to a 0600, owner-only regular file in a 0700 protected directory). Never put it in Git, shell history, command-line arguments, result files, logs, the backup volume, the replica mount, or the recovery temporary location. Protect secret injection and process environments from other users and administrators. Do not use human-chosen passphrases. Missing, malformed, ambiguous or insecure key material fails closed.
- Set `BACKUP_REPLICATION_DIR` to an **existing absolute path**, owned by the job user and mode 0700, separate from the local backup directory and recovery temporary directory. All path components must be real directories, owned by root or the job user, and not group/other-writable (a sticky directory such as `/tmp` may be a parent). Symlinks and traversal are refused. The key directory must also meet these requirements. Provision and protect directories yourself; the script does not create mounts or authenticate them.
- The destination is a **trusted, access-controlled filesystem/mount**, not an adversarial shared directory. It must provide same-directory atomic hard links that fail if a target exists, consistent read-after-write, durable `fsync`, and exclusive control of directory entries. Validate these properties on the selected remote mount; object-store FUSE drivers and network filesystems may not supply them. A hostile owner, root, compromised process, mutable mount or unreliable mount semantics are outside the adapter's security boundary. Encrypted content is authenticated, but deletion, rollback to an older valid replica, and a complete replacement by someone with the key cannot be detected without an independent trusted inventory.
- Limit OS permissions, backup, and control-plane access; apply separate encryption-at-rest protections to local plaintext backups, swap and temporary storage. Archive names, sizes, timing and ciphertext hashes are visible to the storage operator. The shared symmetric key can both produce and decrypt valid replicas; anyone with it can forge them. Separate duties/access accordingly.

## Operation

When `BACKUP_REPLICATION_DIR` or either key variable is set, the scheduled runner opts in after a successful local backup, under the existing lock. The archive name, matching manifest, size, SHA-256 and `pg_restore --list` table-data checks must pass before encryption. Each upload writes a uniquely named encrypted partial, verifies it, fsyncs it, atomically links it to `<archive>.age` without replacement, rereads and authenticates the published object, and reports its ciphertext SHA-256. A retry authenticates the existing object and checks the exact manifest and archive; identical data succeeds, different data or an invalid object fails without replacement. A crash can leave an encrypted `.partial-*.age`; once no writer is active, operators may remove only their own known orphan partials. Do not delete or overwrite a conflicting final object automatically.

The structured result reports `backup.status` separately from `replication.status`. A replication failure returns exit 3, reports a generic error, and skips retention; a later retention-only run also skips if the last result recorded a replication failure. Local backup success remains success. Retry explicitly before local retention removes the archive, or run another successful scheduled backup. Existing behavior is unchanged when replication is not configured.

For a manually created **completed** archive, retry independently (paths must be absolute):

```sh
# Set BACKUP_REPLICATION_DIR and inject exactly one key source via secret manager first.
node scripts/backup/replicate.mjs upload --backup /srv/agencyos-backups/agencyos-EXAMPLE.dump
```

No upload success alone proves recoverability. To read an encrypted replica, authenticate it, check the original manifest, size and SHA-256, and execute the existing verifier against a separately provisioned disposable PostgreSQL instance:

```sh
# /srv/recovery-tmp must be an existing, empty, protected 0700 directory
# on dedicated encrypted ephemeral storage, separate from backup/replica/key.
# Set BACKUP_REPLICATION_DIR, inject the key, and set DATABASE_URL,
# RESTORE_VERIFY_ADMIN_URL, RESTORE_VERIFY_ISOLATION_CONFIRMATION and
# RESTORE_VERIFY_ALLOWED_PORT exactly as in backup-restore-verification.md.
node scripts/backup/replicate.mjs recover --name agencyos-EXAMPLE.dump \
  --temp-dir /srv/recovery-tmp --verify-restore
```

`--verify-restore` calls the existing guarded verifier, which creates and removes its own uniquely named disposable database. Never use an active development or production database as the isolated target; follow every guard in the existing runbook. Without `--verify-restore`, the command checks ciphertext authenticity and the archive checksum only and returns `integrity-verified`, **not** restore verification. A restore failure is a failure of the entire command. Temp plaintext is written only inside a fresh owner-only subdirectory and removed in `finally`, including on authentication or restore failure. Abrupt termination/power loss can leave it behind: inspect and remove abandoned `agencyos-recovery-*` directories after ensuring no recovery is running. File deletion is not secure erasure on SSDs, copy-on-write, snapshots, journaled/network filesystems or backups; use encrypted ephemeral storage with controlled keys and discard those keys according to the storage provider's process. Do not rely on overwriting files for erasure.

## Rotation and recovery

Record each replica's key version in an **independent protected inventory**; no key or key identifier is stored in the replica. Provision new key material to the runner for new backups. Retain old keys separately for as long as any corresponding replica must be recoverable; do not reuse an archive name for different encryption keys (existing objects will be refused). Test key retrieval and full isolated recovery before retiring any key. Loss of the key makes its replicas unrecoverable; compromise requires revocation and an approved re-encryption/migration plan, not just changing an environment variable. Keep offline recovery instructions and independent escrow under designated ownership.

## Batch 3C-2 / deployment decisions

Select and validate an independent off-host storage provider/mount and failure domain; establish retention/immutability, capacity, object inventory and rollback detection, credentials and network controls. Establish key ownership, version inventory, escrow and tested recovery, rotation/re-encryption process, RPO/RTO, alerting on replication failure and backup age, and scheduled isolated recovery drills. Production readiness depends on those decisions and successful representative recovery tests, not this reference adapter or a green upload.
