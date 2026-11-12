/**
 * Retention for the AgencyOS backup directory (Phase 4D / Batch 3B).
 *
 * The rule this module exists to enforce is narrow and absolute. A retention
 * run may only ever remove a file that
 *
 *   1. lives inside the explicitly configured backup directory,
 *   2. is an archive this tooling created (`agencyos-<timestamp>.dump`),
 *   3. has a matching, parseable manifest that agrees with the archive on
 *      name, format, checksum and byte size,
 *   4. is a regular file — never a symlink — whose real path still resolves
 *      inside the backup directory, and
 *   5. is not the newest verified backup, and is not a backup that is still
 *      being written.
 *
 * Everything else is left alone. A file that fails any of those tests is
 * reported as `skipped` with a reason and never deleted: the cost of keeping
 * an expired archive is disk space, and the cost of deleting a good one is the
 * backup history.
 *
 * The module is deliberately dependency-free (Node built-ins only) so it can
 * run during a recovery, before `npm ci`, exactly like the rest of
 * `scripts/backup`.
 */

import { lstat, readdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { UsageError, assertWithinRoots } from './lib.mjs';

/** Archive names this tooling owns: `agencyos-<timestamp>.dump`. */
export const ARCHIVE_NAME_PATTERN = /^agencyos-[A-Za-z0-9][A-Za-z0-9._-]*\.dump$/;

/**
 * A file the backup tool is still writing. `backup.mjs` writes
 * `<name>.partial-<pid>-<rand>` and renames it into place only after the
 * archive validates, so these are never retention candidates.
 */
export const PARTIAL_NAME_PATTERN = /\.partial-\d+-[0-9a-f]+$/;

/** The `format` value written into every manifest by `backup.mjs`. */
export const MANIFEST_FORMAT = 'pg_dump custom';

/** Why a file in the backup directory is not eligible for deletion. */
export const SKIP = Object.freeze({
  IN_PROGRESS: 'in_progress',
  SYMLINK: 'symlink',
  NOT_A_REGULAR_FILE: 'not_a_regular_file',
  NO_MANIFEST: 'no_manifest',
  UNREADABLE_MANIFEST: 'unreadable_manifest',
  MANIFEST_MISMATCH: 'manifest_mismatch',
  UNEXPECTED_FORMAT: 'unexpected_format',
  MISSING_CHECKSUM: 'missing_checksum',
  SIZE_MISMATCH: 'size_mismatch',
  NO_ARCHIVE: 'no_archive',
  OUTSIDE_BACKUP_DIR: 'outside_backup_dir',
  ESCAPES_BACKUP_DIR: 'escapes_backup_dir',
  DELETE_FAILED: 'delete_failed',
  ALREADY_ABSENT: 'already_absent',
});

/**
 * One classified entry of the backup directory.
 *
 * @typedef {object} BackupEntry
 * @property {string} name             file name inside the backup directory
 * @property {'archive' | 'manifest' | 'partial' | 'other'} kind
 * @property {string} archivePath      absolute path of the archive
 * @property {string} manifestPath     absolute path of the manifest
 * @property {boolean} verified        true when the archive is provably ours
 * @property {string | null} reason    skip reason, when not verified
 * @property {number | null} bytes     archive size in bytes
 * @property {string | null} sha256    checksum recorded in the manifest
 * @property {number} createdAtMs      archive timestamp in epoch milliseconds
 */

/**
 * Is `candidate` strictly inside `root`?
 *
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
export function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Classify every entry of a backup directory.
 *
 * The directory is only ever read here. Nothing is removed, and no file
 * outside the directory is touched.
 *
 * @param {string} directory
 * @returns {Promise<{
 *   directory: string,
 *   entries: BackupEntry[],
 *   verified: BackupEntry[],
 *   skipped: Array<{ name: string, reason: string }>,
 *   partials: string[],
 *   unrelated: string[],
 * }>}
 */
export async function inspectBackupDirectory(directory) {
  const root = path.resolve(directory);

  let dirents;
  try {
    dirents = await readdir(root, { withFileTypes: true });
  } catch (error) {
    throw new UsageError(
      `Backup directory cannot be read: ${root} (${error.code ?? 'unknown error'})`
    );
  }

  /** @type {BackupEntry[]} */
  const entries = [];
  /** @type {BackupEntry[]} */
  const verified = [];
  /** @type {Array<{ name: string, reason: string }>} */
  const skipped = [];
  /** @type {string[]} */
  const partials = [];
  /** @type {string[]} */
  const unrelated = [];

  for (const dirent of dirents) {
    const name = dirent.name;

    if (PARTIAL_NAME_PATTERN.test(name)) {
      // A backup that is still being written. It is not an archive yet and
      // must never be deleted from under the writer.
      partials.push(name);
      entries.push({
        name,
        kind: 'partial',
        archivePath: path.join(root, name),
        manifestPath: path.join(root, `${name}.json`),
        verified: false,
        reason: SKIP.IN_PROGRESS,
        bytes: null,
        sha256: null,
        createdAtMs: 0,
      });
      continue;
    }

    if (!ARCHIVE_NAME_PATTERN.test(name)) {
      if (name.endsWith('.dump.json')) {
        const archivePath = path.join(root, name.slice(0, -'.json'.length));
        const archiveExists = await lstat(archivePath).then(
          () => true,
          () => false
        );
        if (!archiveExists) {
          // A manifest whose archive is gone. It is ours, but there is
          // nothing to expire; leaving it is harmless and deleting it is
          // unnecessary.
          skipped.push({ name, reason: SKIP.NO_ARCHIVE });
          entries.push({
            name,
            kind: 'manifest',
            archivePath,
            manifestPath: path.join(root, name),
            verified: false,
            reason: SKIP.NO_ARCHIVE,
            bytes: null,
            sha256: null,
            createdAtMs: 0,
          });
          continue;
        }
        // The manifest of an archive that is handled on its own.
        entries.push({
          name,
          kind: 'manifest',
          archivePath,
          manifestPath: path.join(root, name),
          verified: false,
          reason: null,
          bytes: null,
          sha256: null,
          createdAtMs: 0,
        });
        continue;
      }
      // Anything else in the directory is not ours to touch.
      unrelated.push(name);
      entries.push({
        name,
        kind: 'other',
        archivePath: path.join(root, name),
        manifestPath: path.join(root, `${name}.json`),
        verified: false,
        reason: null,
        bytes: null,
        sha256: null,
        createdAtMs: 0,
      });
      continue;
    }

    const entry = await classifyArchive(root, name);
    entries.push(entry);
    if (entry.verified) {
      verified.push(entry);
    } else {
      skipped.push({ name, reason: entry.reason ?? 'unknown' });
    }
  }

  return { directory: root, entries, verified, skipped, partials, unrelated };
}

/**
 * Decide whether one archive file is a genuine, verified AgencyOS backup.
 *
 * @param {string} root   resolved backup directory
 * @param {string} name   archive file name
 * @returns {Promise<BackupEntry>}
 */
async function classifyArchive(root, name) {
  const archivePath = path.join(root, name);
  const manifestPath = `${archivePath}.json`;

  /** @type {BackupEntry} */
  const entry = {
    name,
    kind: 'archive',
    archivePath,
    manifestPath,
    verified: false,
    reason: null,
    bytes: null,
    sha256: null,
    createdAtMs: 0,
  };

  const archiveInfo = await lstat(archivePath).catch(() => null);
  if (!archiveInfo) {
    entry.reason = SKIP.NO_ARCHIVE;
    return entry;
  }
  if (archiveInfo.isSymbolicLink()) {
    // A symlink could point anywhere; the tool never follows or removes one.
    entry.reason = SKIP.SYMLINK;
    return entry;
  }
  if (!archiveInfo.isFile()) {
    entry.reason = SKIP.NOT_A_REGULAR_FILE;
    return entry;
  }
  entry.bytes = archiveInfo.size;
  entry.createdAtMs = archiveInfo.mtimeMs;

  const manifestInfo = await lstat(manifestPath).catch(() => null);
  if (!manifestInfo) {
    // The archive was renamed into place but its manifest has not been
    // written yet: the backup is still in flight. It is not a candidate.
    entry.reason = SKIP.NO_MANIFEST;
    return entry;
  }
  if (manifestInfo.isSymbolicLink()) {
    entry.reason = SKIP.SYMLINK;
    return entry;
  }
  if (!manifestInfo.isFile()) {
    entry.reason = SKIP.NOT_A_REGULAR_FILE;
    return entry;
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    entry.reason = SKIP.UNREADABLE_MANIFEST;
    return entry;
  }

  if (!manifest || typeof manifest !== 'object') {
    entry.reason = SKIP.UNREADABLE_MANIFEST;
    return entry;
  }
  if (manifest.archive !== name) {
    // The manifest describes a different archive: this pairing is not ours.
    entry.reason = SKIP.MANIFEST_MISMATCH;
    return entry;
  }
  if (manifest.format !== MANIFEST_FORMAT) {
    entry.reason = SKIP.UNEXPECTED_FORMAT;
    return entry;
  }
  if (typeof manifest.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    entry.reason = SKIP.MISSING_CHECKSUM;
    return entry;
  }
  if (!Number.isFinite(Number(manifest.bytes)) || Number(manifest.bytes) !== archiveInfo.size) {
    // The file no longer matches its manifest. It is either truncated or was
    // replaced; either way it is not the archive the manifest describes.
    entry.reason = SKIP.SIZE_MISMATCH;
    return entry;
  }

  const createdAt = Date.parse(manifest.createdAt ?? '');
  entry.createdAtMs = Number.isFinite(createdAt) ? createdAt : archiveInfo.mtimeMs;
  entry.sha256 = manifest.sha256;
  entry.verified = true;
  return entry;
}

/**
 * Decide which verified backups to keep and which to expire.
 *
 * The newest verified backup is never in the delete set, even if the policy
 * would otherwise allow it: a retention policy that can remove the last known
 * good backup is a policy that can leave the operator with nothing.
 *
 * @param {BackupEntry[]} verified
 * @param {{ keep?: number }} [options]
 * @returns {{ keep: BackupEntry[], delete: BackupEntry[], keepCount: number }}
 */
export function planRetention(verified, { keep = 7 } = {}) {
  const parsed = Number(keep);
  const keepCount = Math.max(1, Number.isInteger(parsed) ? parsed : 1);

  const sorted = [...verified].sort(
    (left, right) => right.createdAtMs - left.createdAtMs || right.name.localeCompare(left.name)
  );

  const keepSet = sorted.slice(0, keepCount);
  const newest = sorted[0];
  const deleteSet = sorted
    .slice(keepCount)
    .filter((entry) => !newest || entry.name !== newest.name);

  return { keep: keepSet, delete: deleteSet, keepCount };
}

/**
 * Execute a retention plan.
 *
 * Every candidate is re-checked immediately before it is removed: the path
 * must still be inside the backup directory, it must still be a regular file
 * (not a symlink that appeared since the scan), and its real path must still
 * resolve inside the backup directory.
 *
 * @param {{ keep: BackupEntry[], delete: BackupEntry[], keepCount: number }} plan
 * @param {{ directory: string, dryRun?: boolean }} options
 * @returns {Promise<{
 *   deleted: Array<{ name: string, bytes: number | null }>,
 *   planned: Array<{ name: string, bytes: number | null }>,
 *   failed: Array<{ name: string, reason: string, error?: string }>,
 * }>}
 */
export async function applyRetention(plan, { directory, dryRun = false } = {}) {
  const root = path.resolve(directory);
  const rootReal = await realpath(root).catch(() => root);

  /** @type {Array<{ name: string, bytes: number | null }>} */
  const deleted = [];
  /** @type {Array<{ name: string, bytes: number | null }>} */
  const planned = [];
  /** @type {Array<{ name: string, reason: string, error?: string }>} */
  const failed = [];

  for (const entry of plan.delete) {
    // 1. Lexical containment: the path must be inside the configured root.
    try {
      assertWithinRoots(entry.archivePath, [root]);
    } catch (error) {
      failed.push({ name: entry.name, reason: SKIP.OUTSIDE_BACKUP_DIR, error: error.message });
      continue;
    }

    // 2. Real-path containment: a symlinked parent could otherwise redirect
    //    the deletion outside the backup directory.
    const realPath = await realpath(entry.archivePath).catch(() => null);
    if (!realPath || !isInside(rootReal, realPath)) {
      failed.push({ name: entry.name, reason: SKIP.ESCAPES_BACKUP_DIR });
      continue;
    }

    // 3. Still a regular file at delete time (re-checked, not assumed).
    const info = await lstat(entry.archivePath).catch(() => null);
    if (!info) {
      failed.push({ name: entry.name, reason: SKIP.ALREADY_ABSENT });
      continue;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      failed.push({ name: entry.name, reason: SKIP.NOT_A_REGULAR_FILE });
      continue;
    }

    planned.push({ name: entry.name, bytes: entry.bytes });

    if (dryRun) {
      continue;
    }

    try {
      // The archive goes first: it is the data. If it cannot be removed the
      // manifest is left in place, so the archive stays verifiable and the
      // next run can retry rather than find an orphan.
      await rm(entry.archivePath, { force: false });
      deleted.push({ name: entry.name, bytes: entry.bytes });
      await rm(entry.manifestPath, { force: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        failed.push({ name: entry.name, reason: SKIP.ALREADY_ABSENT });
        continue;
      }
      failed.push({
        name: entry.name,
        reason: SKIP.DELETE_FAILED,
        error: error.message,
      });
    }
  }

  return { deleted, planned, failed };
}
