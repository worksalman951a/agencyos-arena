/**
 * Shared guardrails for the backup and restore-verification tooling.
 *
 * Two properties matter more than anything else here, because both scripts can
 * destroy data if they get them wrong:
 *
 *  1. **A restore must never touch a non-disposable database.** The target
 *     database name must carry the `agencyos_restore_verify_` prefix, must not
 *     already exist, and must not be the database named by `DATABASE_URL`
 *     (the application's own database). Those checks live in
 *     `assertDisposableTarget` and are enforced *before* `CREATE DATABASE`.
 *
 *  2. **Credentials never reach a log, an error message or a child process
 *     argument list.** A connection URL is parsed here and only ever handed to
 *     `pg_dump` / `pg_restore` / `psql` through `PG*` environment variables,
 *     which are process-local and not visible in `ps` output. `redactUrl` exists
 *     so anything that *does* print a URL prints a safe form.
 *
 * This module is deliberately dependency-free (Node built-ins only) so it can
 * run before `npm ci` in a recovery situation.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/** Prefix every disposable restore-verification database must carry. */
export const RESTORE_DB_PREFIX = 'agencyos_restore_verify_';

/** Exit codes the tooling uses, so a CI step can distinguish failure modes. */
export const EXIT = Object.freeze({
  OK: 0,
  /** A safety invariant was violated (bad target, existing file, unsafe path). */
  UNSAFE: 2,
  /** The external tool (pg_dump/pg_restore/psql) failed. */
  TOOL_FAILED: 3,
  /** The produced or supplied archive failed its integrity check. */
  INTEGRITY: 4,
  /** Post-restore data verification found a mismatch. */
  VERIFY_FAILED: 5,
  /** Another backup run holds the lock; this run was refused (Batch 3B). */
  LOCKED: 6,
  /** The backup destination is missing or not writable (Batch 3B). */
  STORAGE: 7,
});

/**
 * Remove the password from a PostgreSQL URL for safe display.
 *
 * `postgresql://user:secret@host:5432/db` -> `postgresql://user:***@host:5432/db`.
 * A URL that cannot be parsed is replaced wholesale rather than echoed, because
 * an unparseable value may still contain a credential.
 */
/**
 * @param {string | undefined} url
 * @returns {string}
 */
export function redactUrl(url) {
  if (!url) return '<unset>';
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    // `URL#toString` re-encodes the username; that is harmless and safe.
    return parsed.toString();
  } catch {
    return '<unparseable connection string redacted>';
  }
}

/**
 * Parsed connection details, plus the libpq environment they map to.
 *
 * @typedef {object} Connection
 * @property {string} host
 * @property {string} port
 * @property {string | undefined} user
 * @property {string | undefined} password
 * @property {string} database
 * @property {string} search
 * @property {string | undefined} sslmode
 *
 * @param {string | undefined} url
 * @param {string} [label]
 * @returns {Connection}
 */
export function parseConnectionUrl(url, label = 'connection URL') {
  if (!url) {
    throw new UsageError(`${label} is not set`);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new UsageError(`${label} is not a valid URL`);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new UsageError(`${label} must use the postgres:// or postgresql:// scheme`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new UsageError(`${label} does not name a database`);
  }

  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database,
    /** `?schema=` and friends from Prisma URLs; libpq ignores them. */
    search: parsed.search,
    sslmode: parsed.searchParams.get('sslmode') ?? undefined,
  };
}

/**
 * The environment variables libpq clients read.
 *
 * Passing credentials this way (rather than in `argv`) keeps them out of
 * `ps` output and out of any error message that quotes the command line.
 *
 * @param {Connection} connection
 * @param {Record<string, string>} [overrides]
 * @returns {Record<string, string | undefined>}
 */
export function libpqEnv(connection, overrides = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    // Drop any ambient libpq settings so a stray PGDATABASE in the operator's
    // shell cannot silently retarget the command.
    if (/^PG[A-Z]+$/.test(key)) delete env[key];
  }
  env.PGHOST = connection.host;
  env.PGPORT = connection.port;
  if (connection.user) env.PGUSER = connection.user;
  if (connection.password !== undefined) env.PGPASSWORD = connection.password;
  env.PGDATABASE = connection.database;
  if (connection.sslmode) env.PGSSLMODE = connection.sslmode;
  // Never prompt: a missing password must fail fast, not hang a CI job. The
  // PG* sweep above already removed any ambient PGPASSFILE; the callers also
  // pass the tools' own no-prompt flags (`-w` / `--no-password`), so libpq
  // errors instead of blocking on a terminal that does not exist in CI.
  env.PGCONNECT_TIMEOUT = env.PGCONNECT_TIMEOUT ?? '15';
  return { ...env, ...overrides };
}

/** A usage or safety problem the operator must fix (never retried blindly). */
export class UsageError extends Error {
  constructor(message, exitCode = EXIT.UNSAFE) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = exitCode;
  }
}

/**
 * Run an external PostgreSQL client, streaming stdout/stderr through optional
 * handlers. Resolves with `{ code, stderrTail }`; never throws for a non-zero
 * exit, so the caller decides what the exit code means.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(stream: import('node:stream').Readable) => void} [options.stdout]
 * @param {string} [options.cwd]
 * @returns {Promise<{ code: number, stderrTail: string }>}
 */
export function runTool(command, args, { env, stdout, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: env ?? process.env,
      cwd,
      stdio: ['ignore', stdout ? 'pipe' : 'ignore', 'pipe'],
    });

    // Keep the tail only: a full stderr can be megabytes on a large restore and
    // is never needed to diagnose, while the tail always names the failing
    // statement.
    const TAIL_LIMIT = 4000;
    let stderrTail = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-TAIL_LIMIT);
    });

    child.on('error', (error) => {
      reject(missingBinary(command, error));
    });

    if (stdout && child.stdout) {
      stdout(child.stdout);
    }

    child.on('close', (code) => resolve({ code: code ?? 1, stderrTail }));
  });
}

function missingBinary(command, error) {
  if (error.code === 'ENOENT') {
    const hint = command.startsWith('pg_') || command === 'psql' ? ' PostgreSQL client tools' : '';
    const failure = new UsageError(
      `Required command "${command}" was not found on PATH.${hint} are required ` +
        '(Debian/Ubuntu: `apt-get install -y postgresql-client`; the CI workflow ' +
        'installs them for the backup-verify job).',
      EXIT.TOOL_FAILED
    );
    failure.cause = error;
    return failure;
  }
  return error;
}

/**
 * sha256 of a file, streamed so a multi-GB dump does not fill memory.
 *
 * @param {string} file
 * @returns {Promise<string>}
 */
export async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * File size in bytes, or `null` when the path does not exist.
 *
 * @param {string} file
 * @returns {Promise<number | null>}
 */
export async function fileSize(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

/**
 * Create `file` exclusively, failing if it already exists.
 *
 * `wx` is the one open mode that cannot clobber an existing backup; a plain
 * `w` would silently truncate the previous good dump the first time the tool
 * was re-run with a stale name.
 */
/**
 * @param {string} file
 * @returns {Promise<import('node:fs/promises').FileHandle>}
 */
export async function openExclusive(file) {
  try {
    return await open(file, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new UsageError(
        `Refusing to overwrite an existing backup: ${file}. ` +
          'Pass --force-replace only after confirming the old archive is expendable.',
        EXIT.UNSAFE
      );
    }
    throw error;
  }
}

/**
 * Write a file atomically: `tmp` then `rename`. A half-written manifest must
 * never be mistaken for a complete one after an interrupted run.
 */
/**
 * @param {string} file
 * @param {string} contents
 * @returns {Promise<void>}
 */
export async function writeFileAtomic(file, contents) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, contents, { mode: 0o600 });
  await rename(tmp, file);
}

/**
 * Best-effort removal of a partial artifact (never a previous good backup).
 *
 * @param {string} file
 * @returns {Promise<void>}
 */
export async function removeIfExists(file) {
  await rm(file, { force: true });
}

/**
 * Check that `candidate` sits inside at least one `allowedRoot`, resolving
 * symlinks. Prevents an operator-supplied `--output` from escaping the backup
 * directory (e.g. `--output ../../etc/shadow`) and overwriting something that
 * is not a backup at all.
 */
/**
 * @param {string} candidate
 * @param {string[]} allowedRoots
 * @returns {Promise<string>} the resolved candidate path
 */
export async function assertWithinRoots(candidate, allowedRoots) {
  const resolvedCandidate = path.resolve(candidate);

  for (const root of allowedRoots) {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return resolvedCandidate;
    }
    if (relative === '') {
      throw new UsageError(`Refusing to use the backup root itself as a file: ${candidate}`);
    }
  }

  throw new UsageError(
    `Refusing to write outside the allowed backup roots (${allowedRoots.join(', ')}): ${candidate}`
  );
}

/**
 * Enforce that a restore target is a disposable, isolated database.
 *
 * Called BEFORE any `CREATE DATABASE`, and again after connecting, so a
 * mismatch between what was validated and what was actually reached cannot slip
 * through.
 *
 * @param {object} params
 * @param {Connection} params.target      parsed target connection
 * @param {Connection} [params.application] parsed `DATABASE_URL`, if configured
 * @param {string} [params.confirmation] value of RESTORE_VERIFY_ISOLATION_CONFIRMATION
 * @param {string | number} [params.allowedPort] when set, the target must use this port
 * @returns {true}
 */
export function assertDisposableTarget({ target, application, confirmation, allowedPort }) {
  if (confirmation !== 'I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET') {
    throw new UsageError(
      'Restore refused: set RESTORE_VERIFY_ISOLATION_CONFIRMATION to ' +
        '"I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET" after verifying out of band that the ' +
        'target is a disposable database that holds no data you need.'
    );
  }

  // Severity order matters for the message the operator sees: "you pointed this
  // at the live database" is a far more serious mistake than "the name lacks a
  // prefix", and it must not be masked by the weaker check.
  if (application) {
    // Same host AND same port AND same database name is the application's own
    // database — the one thing this tooling must never touch.
    if (
      application.host === target.host &&
      application.port === target.port &&
      application.database === target.database
    ) {
      throw new UsageError(
        `Restore refused: target "${target.database}" is the application database named by ` +
          'DATABASE_URL. A restore may only write into a separate, disposable verification ' +
          'database.'
      );
    }
  }

  if (!target.database.startsWith(RESTORE_DB_PREFIX)) {
    throw new UsageError(
      `Restore refused: target database "${target.database}" must start with ` +
        `"${RESTORE_DB_PREFIX}". A restore may only ever write into a disposable ` +
        'verification database.'
    );
  }

  if (allowedPort && String(target.port) !== String(allowedPort)) {
    throw new UsageError(
      `Restore refused: target port ${target.port} does not match the approved isolated port ${allowedPort}.`
    );
  }

  return true;
}

/**
 * Path used by the CI job for ephemeral backup artifacts. Kept in one place so
 * the workflow and the scripts cannot disagree.
 */
/**
 * @returns {string}
 */
export function defaultBackupDir() {
  return process.env.BACKUP_DIR ?? path.join(process.cwd(), 'backups');
}

/**
 * Ensure a directory exists with owner-only permissions.
 *
 * @param {string} dir
 * @returns {Promise<string>}
 */
export async function ensurePrivateDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export { existsSync, readFile, createWriteStream };
