#!/usr/bin/env node
/**
 * One-shot scheduled backup runner (Phase 4D / Batch 3B).
 *
 * This is a *runner*, not a scheduler. It performs exactly one backup and
 * exits; the schedule itself belongs to the platform (cron, Task Scheduler, a
 * Kubernetes CronJob, a container platform's scheduler). Nothing here stays
 * resident, and nothing here assumes a hosting provider.
 *
 * It reuses the verified Batch 3A tooling unchanged: the actual dump is
 * produced by `scripts/backup/backup.mjs`, which is invoked as a child
 * process. This runner adds only what a scheduled, unattended job needs:
 *
 *   - a lock, so two runs can never write to the same backup directory at
 *     once;
 *   - a retention pass that can only ever remove archives this tooling
 *     created, never the newest verified backup, and never a backup that is
 *     still being written;
 *   - a structured result (status, timestamps, archive identity and checksum,
 *     retention outcome, sanitized error) written to disk and printed as one
 *     machine-readable line;
 *   - documented exit codes and an optional webhook hook, so an external
 *     scheduler or log collector can react without any paid service.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/backup/scheduled-backup.mjs
 *   node scripts/backup/scheduled-backup.mjs --dir /srv/backups --keep 7
 *   node scripts/backup/scheduled-backup.mjs --retention-only --dry-run
 *
 * Exit codes:
 *   0  success
 *   2  usage or safety violation (bad option, missing DATABASE_URL, …)
 *   3  the backup command failed, or a retention deletion failed
 *   4  the produced archive failed its integrity check
 *   5  the produced archive failed verification
 *   6  another run holds the lock; this run was refused
 *   7  the backup destination is missing or not writable
 */

import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXIT,
  UsageError,
  defaultBackupDir,
  ensurePrivateDir,
  parseConnectionUrl,
  writeFileAtomic,
} from './lib.mjs';
import { applyRetention, inspectBackupDirectory, isInside, planRetention } from './retention.mjs';

/** The verified Batch 3A backup command this runner drives. */
const BACKUP_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backup.mjs');

/** How many verified backups are kept when nothing else is configured. */
const DEFAULT_KEEP = 7;

/** A lock older than this whose owner is gone is treated as abandoned. */
const DEFAULT_LOCK_STALE_SECONDS = 6 * 60 * 60;

/** Upper bound on the child's captured output, so a huge log cannot eat RAM. */
const MAX_CAPTURE = 64 * 1024;

/** The webhook request is abandoned after this long. */
const HOOK_TIMEOUT_MS = 10_000;

/** File name used for the structured result inside the backup directory. */
const DEFAULT_RESULT_FILE = 'last-run.json';

/** File name used for the run lock inside the backup directory. */
const DEFAULT_LOCK_FILE = '.agencyos-backup.lock';

function usage() {
  return `Usage: node scripts/backup/scheduled-backup.mjs [options]

Performs ONE backup, then applies the retention policy, then exits.
The schedule itself is provided by the platform (cron, Task Scheduler, …).

Options:
  --dir <path>        Backup directory. Default: $BACKUP_DIR or ./backups
  --label <text>      Label recorded in the manifest (no secrets)
  --keep <n>          Verified backups to keep. Default: $BACKUP_RETENTION_COUNT or ${DEFAULT_KEEP}
  --dry-run           Report the retention plan without deleting anything
  --retention-only    Apply retention only; create no new backup
  --result-file <p>   Structured result. Default: <dir>/${DEFAULT_RESULT_FILE}
  --lock-file <p>     Run lock. Default: <dir>/${DEFAULT_LOCK_FILE}
  --hook-url <url>    Webhook (http/https) that receives the structured result
  --help              Show this message

Environment:
  DATABASE_URL              Source database (required unless --retention-only)
  BACKUP_DIR                Default backup directory
  BACKUP_LABEL              Default manifest label
  BACKUP_RETENTION_COUNT    Default number of backups to keep
  BACKUP_RESULT_FILE        Default structured result path
  BACKUP_LOCK_FILE          Default run-lock path
  BACKUP_LOCK_STALE_SECONDS How old an abandoned lock may be (default ${DEFAULT_LOCK_STALE_SECONDS})
  BACKUP_HOOK_URL           Default webhook URL
  BACKUP_HOOK_TOKEN         Bearer token for the webhook (never logged)
`;
}

/**
 * Remove credential material from anything that may be logged.
 *
 * The password never travels on a command line, but a PostgreSQL error can
 * still quote a connection string, so every string that reaches a log or the
 * result file goes through here first.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function redactCredentials(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/(postgres(?:ql)?:\/\/)([^:@\s/]+):([^@\s/]+)@/gi, '$1$2:***@')
    .replace(/\b(PGPASSWORD|PGPASSFILE|password)\s*[=:]\s*\S+/gi, '$1=***');
}

/**
 * Redact and bound a message for the structured result.
 *
 * @param {unknown} value
 * @param {number} [limit]
 * @returns {string}
 */
export function sanitizeMessage(value, limit = 500) {
  return redactCredentials(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

/**
 * Parse the command line. Unknown options are a usage error rather than
 * something silently ignored.
 *
 * @param {string[]} argv
 * @returns {Record<string, any>}
 */
export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--dir':
        options.dir = argv[++index];
        break;
      case '--label':
        options.label = argv[++index];
        break;
      case '--keep':
        options.keep = argv[++index];
        break;
      case '--result-file':
        options.resultFile = argv[++index];
        break;
      case '--lock-file':
        options.lockFile = argv[++index];
        break;
      case '--hook-url':
        options.hookUrl = argv[++index];
        break;
      case '--lock-stale-seconds':
        options.lockStaleSeconds = argv[++index];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--retention-only':
        options.retentionOnly = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new UsageError(`Unknown option: ${arg}`);
    }
  }
  return options;
}

/**
 * Resolve the webhook independently of the rest of the configuration.
 *
 * The hook is the reporting channel, so it must survive a failure in the
 * *backup* configuration: a run that cannot reach the database still has to
 * tell the monitoring endpoint about it.
 *
 * @param {Record<string, any>} options
 * @param {{ env?: Record<string, string | undefined> }} [context]
 * @returns {{ hookUrl: string | null, hookToken: string | null }}
 */
export function resolveHook(options, { env = process.env } = {}) {
  const hookUrl = options.hookUrl ?? env.BACKUP_HOOK_URL ?? null;
  if (!hookUrl) {
    return { hookUrl: null, hookToken: env.BACKUP_HOOK_TOKEN ?? null };
  }

  let parsed;
  try {
    parsed = new URL(hookUrl);
  } catch {
    throw new UsageError('The webhook URL is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UsageError('The webhook URL must use the http or https scheme.');
  }

  return { hookUrl, hookToken: env.BACKUP_HOOK_TOKEN ?? null };
}

/**
 * Merge command line, environment and defaults into one configuration.
 *
 * @param {Record<string, any>} options
 * @param {{ env?: Record<string, string | undefined> }} [context]
 * @returns {object}
 */
export function resolveConfig(options, { env = process.env } = {}) {
  const directory = path.resolve(options.dir ?? env.BACKUP_DIR ?? defaultBackupDir());

  const keepRaw = options.keep ?? env.BACKUP_RETENTION_COUNT ?? DEFAULT_KEEP;
  const keep = Number(keepRaw);
  if (!Number.isInteger(keep) || keep < 1) {
    throw new UsageError(
      `Retention count must be a positive integer (got ${JSON.stringify(String(keepRaw))}).`
    );
  }

  const lockStaleRaw =
    options.lockStaleSeconds ?? env.BACKUP_LOCK_STALE_SECONDS ?? DEFAULT_LOCK_STALE_SECONDS;
  const lockStaleSeconds = Number(lockStaleRaw);
  if (!Number.isFinite(lockStaleSeconds) || lockStaleSeconds < 0) {
    throw new UsageError(
      `Lock stale threshold must be a non-negative number (got ${JSON.stringify(String(lockStaleRaw))}).`
    );
  }

  let source = null;
  if (env.DATABASE_URL) {
    const connection = parseConnectionUrl(env.DATABASE_URL, 'DATABASE_URL');
    source = {
      host: connection.host,
      port: connection.port,
      database: connection.database,
    };
  } else if (!options.retentionOnly) {
    throw new UsageError('DATABASE_URL is not set');
  }

  return {
    directory,
    keep,
    dryRun: Boolean(options.dryRun),
    retentionOnly: Boolean(options.retentionOnly),
    label: options.label ?? env.BACKUP_LABEL ?? null,
    resultFile: path.resolve(
      options.resultFile ?? env.BACKUP_RESULT_FILE ?? path.join(directory, DEFAULT_RESULT_FILE)
    ),
    lockFile: path.resolve(
      options.lockFile ?? env.BACKUP_LOCK_FILE ?? path.join(directory, DEFAULT_LOCK_FILE)
    ),
    lockStaleSeconds,
    backupScript: BACKUP_SCRIPT,
    source,
  };
}

/**
 * Best-effort location of the result file, used when the configuration
 * itself could not be resolved, so that a misconfigured run still leaves a
 * trace for the operator.
 *
 * @param {Record<string, any>} options
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function fallbackResultFile(options, env) {
  try {
    const directory = path.resolve(options.dir ?? env.BACKUP_DIR ?? defaultBackupDir());
    return path.resolve(
      options.resultFile ?? env.BACKUP_RESULT_FILE ?? path.join(directory, DEFAULT_RESULT_FILE)
    );
  } catch {
    return null;
  }
}

/**
 * Fail safely when the destination storage is not usable.
 *
 * A permission bit is not proof: the directory may be read-only, full, or
 * mounted read-only. The only reliable test is to write something.
 *
 * @param {string} directory
 * @returns {Promise<void>}
 */
export async function assertWritableDirectory(directory) {
  let info;
  try {
    info = await stat(directory);
  } catch {
    throw Object.assign(new Error(`Backup directory is not available: ${directory}`), {
      exitCode: EXIT.STORAGE,
      code: 'storage_unavailable',
    });
  }
  if (!info.isDirectory()) {
    throw Object.assign(new Error(`Backup path is not a directory: ${directory}`), {
      exitCode: EXIT.STORAGE,
      code: 'storage_unavailable',
    });
  }

  const probe = path.join(
    directory,
    `.agencyos-write-probe-${process.pid}-${randomBytes(4).toString('hex')}`
  );
  try {
    await writeFile(probe, 'probe', { mode: 0o600 });
  } catch {
    throw Object.assign(new Error(`Backup directory is not writable: ${directory}`), {
      exitCode: EXIT.STORAGE,
      code: 'storage_unavailable',
    });
  } finally {
    await rm(probe, { force: true }).catch(() => undefined);
  }
}

/**
 * Is a process still running?
 *
 * `EPERM` means the process exists but belongs to another user, which still
 * counts as alive.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Read the lock file and decide whether it is a live run or a leftover.
 *
 * @param {string} lockFile
 * @param {number} staleAfterSeconds
 * @returns {Promise<{ pid: number | null, ageSeconds: number, alive: boolean, stale: boolean } | null>}
 */
export async function inspectLock(lockFile, staleAfterSeconds) {
  let info;
  try {
    info = await lstat(lockFile);
  } catch {
    return null;
  }
  if (!info.isFile()) {
    // Not something this tool wrote. Treat it as a live lock: refuse.
    return { pid: null, ageSeconds: 0, alive: true, stale: false };
  }

  let pid = null;
  let startedAtMs = info.mtimeMs;
  try {
    const parsed = JSON.parse(await readFile(lockFile, 'utf8'));
    if (Number.isInteger(parsed?.pid)) pid = parsed.pid;
    const parsedStart = Date.parse(parsed?.startedAt ?? '');
    if (Number.isFinite(parsedStart)) startedAtMs = parsedStart;
  } catch {
    // An unreadable lock falls back to its modification time.
  }

  const ageSeconds = Math.max(0, (Date.now() - startedAtMs) / 1000);
  const alive = pid === null ? true : isProcessAlive(pid);

  return { pid, ageSeconds, alive, stale: !alive && ageSeconds > staleAfterSeconds };
}

/**
 * Take the run lock, or refuse because another run holds it.
 *
 * @param {string} lockFile
 * @param {{ staleAfterSeconds: number }} options
 * @returns {Promise<{ acquired: true, reclaimed: boolean }>}
 */
export async function acquireLock(lockFile, { staleAfterSeconds }) {
  await mkdir(path.dirname(lockFile), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockFile, 'wx', 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
            host: os.hostname(),
          })}\n`
        );
      } finally {
        await handle.close();
      }
      return { acquired: true, reclaimed: attempt > 0 };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    const existing = await inspectLock(lockFile, staleAfterSeconds);
    if (attempt === 0 && existing?.stale) {
      // The owner is gone and the lock is old enough to be abandoned.
      await rm(lockFile, { force: true });
      continue;
    }
    break;
  }

  throw new UsageError(
    `Another backup run is already in progress (lock file: ${lockFile}). ` +
      'Refusing to start a second run, so two backups cannot write to the same directory at once.',
    EXIT.LOCKED
  );
}

/**
 * Release the run lock.
 *
 * @param {string} lockFile
 * @returns {Promise<void>}
 */
export async function releaseLock(lockFile) {
  await rm(lockFile, { force: true }).catch(() => undefined);
}

/**
 * Run the verified Batch 3A backup command as a child process.
 *
 * The child inherits the environment (so `DATABASE_URL` and the libpq
 * variables travel through the environment, never on a command line) and its
 * output is forwarded so the operator sees it in the scheduler's log.
 *
 * @param {{ scriptPath: string, directory: string, label: string | null, env: NodeJS.ProcessEnv, onOutput?: (text: string) => void }} options
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
export function runBackupCommand({ scriptPath, directory, label, env, onOutput }) {
  return new Promise((resolve, reject) => {
    const args = [scriptPath, '--dir', directory];
    if (label) args.push('--label', label);

    const child = spawn(process.execPath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // The head of stdout is kept (the archive path is printed early) and the
    // tail of stderr (the reason a dump failed is printed last).
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(0, MAX_CAPTURE);
      onOutput?.(redactCredentials(chunk));
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-MAX_CAPTURE);
      onOutput?.(redactCredentials(chunk));
    });

    child.on('error', (error) => {
      reject(
        Object.assign(new Error(`The backup command could not be started: ${error.message}`), {
          exitCode: EXIT.TOOL_FAILED,
          code: 'backup_spawn_failed',
        })
      );
    });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Read the archive identity out of the backup command's own output.
 *
 * @param {string} stdout
 * @returns {{ destination: string | null, sha256: string | null, manifest: string | null }}
 */
export function parseArchiveFromStdout(stdout) {
  return {
    destination: stdout.match(/^\[backup\] destination\s+(.+)$/m)?.[1]?.trim() ?? null,
    sha256: stdout.match(/^\[backup\] sha256\s+([0-9a-f]{64})$/m)?.[1] ?? null,
    manifest: stdout.match(/^\[backup\] manifest\s+(.+)$/m)?.[1]?.trim() ?? null,
  };
}

/**
 * Identify the archive this run produced.
 *
 * The backup command's own output is authoritative; the directory scan is a
 * fallback for the (unlikely) case where the output was truncated.
 *
 * @param {string} directory
 * @param {string} stdout
 * @param {number} startedAtMs
 * @returns {Promise<{ name: string, path: string, bytes: number | null, sha256: string | null, manifestPath: string } | null>}
 */
export async function resolveArchive(directory, stdout, startedAtMs) {
  const root = path.resolve(directory);
  const parsed = parseArchiveFromStdout(stdout);

  if (parsed.destination) {
    const archivePath = path.resolve(parsed.destination);
    if (isInside(root, archivePath)) {
      const manifest = await readManifest(`${archivePath}.json`);
      const size = await stat(archivePath).then(
        (info) => info.size,
        () => null
      );
      if (manifest) {
        return {
          name: path.basename(archivePath),
          path: archivePath,
          bytes: size,
          sha256: manifest.sha256,
          manifestPath: `${archivePath}.json`,
        };
      }
    }
  }

  const inspection = await inspectBackupDirectory(root);
  const candidates = inspection.verified
    .filter((entry) => entry.createdAtMs >= startedAtMs - 2000)
    .sort((left, right) => right.createdAtMs - left.createdAtMs);
  const newest = candidates[0];
  if (!newest) return null;

  return {
    name: newest.name,
    path: newest.archivePath,
    bytes: newest.bytes,
    sha256: newest.sha256,
    manifestPath: newest.manifestPath,
  };
}

/**
 * Read a manifest, returning null when it is absent or unreadable.
 *
 * @param {string} file
 * @returns {Promise<Record<string, any> | null>}
 */
async function readManifest(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read the previous run's result, used to learn whether the last backup
 * failed (so retention never prunes after a failed backup).
 *
 * @param {string} file
 * @returns {Promise<Record<string, any> | null>}
 */
async function readPreviousResult(file) {
  return readManifest(file);
}

/**
 * Deliver the structured result to a webhook.
 *
 * The payload contains no credentials: the result never holds the password,
 * the user, or an unredacted connection URL.
 *
 * @param {string} url
 * @param {string | null} token
 * @param {Record<string, any>} payload
 * @returns {Promise<{ ok: boolean, status: number }>}
 */
export async function sendWebhook(url, token, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOOK_TIMEOUT_MS);
  try {
    /** @type {Record<string, string>} */
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip everything secret from a webhook URL before it is logged.
 *
 * @param {string} url
 * @returns {string}
 */
export function redactHookUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '<unparseable webhook url>';
  }
}

/**
 * Perform one scheduled backup run.
 *
 * @param {string[]} argv
 * @param {{
 *   runBackup?: Function,
 *   sendHook?: Function,
 *   logger?: { log?: Function, error?: Function },
 *   env?: Record<string, string | undefined>,
 *   clock?: () => Date,
 * }} [deps]
 * @returns {Promise<{ exitCode: number, result: Record<string, any> | null }>}
 */
export async function runScheduledBackup(argv = [], deps = {}) {
  const runBackup = deps.runBackup ?? runBackupCommand;
  const sendHook = deps.sendHook ?? sendWebhook;
  const logger = deps.logger ?? console;
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? (() => new Date());

  const startedAt = clock();
  const startedAtMs = startedAt.getTime();

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    logger.error?.(`[scheduled-backup] FAILED: ${sanitizeMessage(error.message)}`);
    return { exitCode: error.exitCode ?? EXIT.UNSAFE, result: null };
  }

  if (options.help) {
    logger.log?.(usage());
    return { exitCode: EXIT.OK, result: null };
  }

  /** @type {Record<string, any>} */
  const result = {
    tool: 'agencyos-scheduled-backup',
    schemaVersion: 1,
    runId: randomUUID(),
    status: 'failed',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: null,
    directory: null,
    source: null,
    backup: {
      status: 'not-run',
      lastStatus: 'unknown',
      exitCode: null,
      durationMs: null,
      archive: null,
      manifestPath: null,
      reason: null,
    },
    retention: {
      status: 'not-run',
      reason: null,
      policy: null,
      scanned: 0,
      kept: [],
      deleted: [],
      planned: [],
      skipped: [],
      failures: [],
      warnings: [],
      unrelated: 0,
      partials: 0,
    },
    lock: { path: null, acquired: false, reclaimed: false, released: false },
    hook: { status: 'not-configured', url: null, httpStatus: null, error: null },
    error: null,
  };

  let exitCode = EXIT.OK;
  /** @type {ReturnType<typeof resolveConfig> | null} */
  let config = null;
  /** @type {string | null} */
  let resultFilePath = null;

  // The hook is resolved first and on its own: a run that cannot even reach
  // the database still has to tell the monitoring endpoint about it.
  let hook = { hookUrl: null, hookToken: null };
  /** @type {Error | null} */
  let hookError = null;
  try {
    hook = resolveHook(options, { env });
    result.hook.url = hook.hookUrl ? redactHookUrl(hook.hookUrl) : null;
  } catch (error) {
    hookError = error;
  }

  try {
    if (hookError) throw hookError;
    config = resolveConfig(options, { env });
    resultFilePath = config.resultFile;
    result.directory = config.directory;
    result.source = config.source;
    result.lock.path = config.lockFile;
    result.retention.policy = {
      keep: config.keep,
      dryRun: config.dryRun,
      directory: config.directory,
      mode: config.retentionOnly ? 'retention-only' : 'backup-and-retention',
    };

    // 1. The destination must be usable before anything is written or removed.
    try {
      await ensurePrivateDir(config.directory);
    } catch {
      throw Object.assign(new Error(`Backup directory is not available: ${config.directory}`), {
        exitCode: EXIT.STORAGE,
        code: 'storage_unavailable',
      });
    }
    await assertWritableDirectory(config.directory);

    // 2. One run at a time per backup directory.
    const lock = await acquireLock(config.lockFile, {
      staleAfterSeconds: config.lockStaleSeconds,
    });
    result.lock.acquired = true;
    result.lock.reclaimed = lock.reclaimed;

    try {
      // 3. The backup itself, unless this run only prunes.
      let carriedStatus = 'unknown';
      if (config.retentionOnly) {
        const previous = await readPreviousResult(config.resultFile);
        carriedStatus = previous?.backup?.lastStatus ?? 'unknown';
        result.backup.status = 'skipped';
        result.backup.reason = 'retention_only';
      } else {
        const backupStartedMs = Date.now();
        const outcome = await runBackup({
          scriptPath: config.backupScript,
          directory: config.directory,
          label: config.label,
          env,
          onOutput: (text) => process.stdout.write(text),
        });

        result.backup.exitCode = outcome.exitCode;
        result.backup.durationMs = Date.now() - backupStartedMs;

        if (outcome.exitCode === 0) {
          result.backup.status = 'succeeded';
          result.backup.lastStatus = 'succeeded';
          const archive = await resolveArchive(config.directory, outcome.stdout, backupStartedMs);
          result.backup.archive = archive;
          result.backup.manifestPath = archive?.manifestPath ?? null;
        } else {
          result.backup.status = 'failed';
          result.backup.lastStatus = 'failed';
          exitCode = [EXIT.UNSAFE, EXIT.TOOL_FAILED, EXIT.INTEGRITY, EXIT.VERIFY_FAILED].includes(
            outcome.exitCode
          )
            ? outcome.exitCode
            : EXIT.TOOL_FAILED;
          result.error = {
            code: 'backup_failed',
            message: sanitizeMessage(
              outcome.stderr.trim() || `The backup command exited with code ${outcome.exitCode}.`
            ),
            exitCode,
          };
        }
      }

      result.backup.lastStatus =
        result.backup.status === 'skipped' ? carriedStatus : result.backup.lastStatus;

      // 4. Retention. Never after a failed backup: the previous verified
      //    backups are the only known-good history left at that point.
      if (result.backup.status === 'failed') {
        result.retention.status = 'skipped';
        result.retention.reason = 'backup_failed';
      } else if (result.backup.lastStatus === 'failed') {
        result.retention.status = 'skipped';
        result.retention.reason = 'latest_backup_failed';
        result.status = 'skipped';
      } else {
        const inspection = await inspectBackupDirectory(config.directory);
        const plan = planRetention(inspection.verified, { keep: config.keep });
        const outcome = await applyRetention(plan, {
          directory: config.directory,
          dryRun: config.dryRun,
        });

        result.retention.status = config.dryRun ? 'dry-run' : 'applied';
        result.retention.scanned = inspection.entries.length;
        result.retention.kept = plan.keep.map((entry) => entry.name);
        result.retention.deleted = outcome.deleted.map((item) => item.name);
        result.retention.planned = outcome.planned.map((item) => item.name);
        result.retention.skipped = inspection.skipped;
        result.retention.failures = outcome.failed.map((item) => ({
          name: item.name,
          reason: item.reason,
        }));
        result.retention.warnings = outcome.warnings.map((item) => ({
          name: item.name,
          reason: item.reason,
        }));
        result.retention.unrelated = inspection.unrelated.length;
        result.retention.partials = inspection.partials.length;

        if (outcome.failed.length > 0) {
          exitCode = EXIT.TOOL_FAILED;
          result.status = 'failed';
          result.error = {
            code: 'retention_failed',
            message: sanitizeMessage(
              `Retention could not remove ${outcome.failed.length} file(s): ${outcome.failed
                .map((item) => `${item.name} (${item.reason})`)
                .join(', ')}`
            ),
            exitCode,
          };
        } else {
          result.status = 'succeeded';
        }
      }
    } finally {
      await releaseLock(config.lockFile);
      result.lock.released = true;
    }
  } catch (error) {
    exitCode = error.exitCode ?? EXIT.TOOL_FAILED;
    result.status = 'failed';
    result.error = {
      code: error.code ?? 'error',
      message: sanitizeMessage(error.message),
      exitCode,
    };
    logger.error?.(`[scheduled-backup] FAILED: ${result.error.message}`);
    // A misconfigured run still leaves a trace, if a result file can be
    // located at all.
    resultFilePath ??= fallbackResultFile(options, env);
  }

  // 5. Finish the structured result.
  result.finishedAt = clock().toISOString();
  result.durationMs = Math.max(0, Date.now() - startedAtMs);

  // 6. Deliver the hook, then persist the result. The hook has a bounded
  //    timeout, so the result file is always written afterwards.
  if (hook.hookUrl) {
    try {
      const hookOutcome = await sendHook(hook.hookUrl, hook.hookToken, result);
      result.hook.status = hookOutcome.ok ? 'sent' : 'failed';
      result.hook.httpStatus = hookOutcome.status ?? null;
      result.hook.error = hookOutcome.ok
        ? null
        : `The webhook responded with ${hookOutcome.status}.`;
    } catch (error) {
      result.hook.status = 'failed';
      result.hook.error = sanitizeMessage(error.message);
    }
  }

  if (resultFilePath) {
    try {
      await mkdir(path.dirname(resultFilePath), { recursive: true, mode: 0o700 });
      await writeFileAtomic(resultFilePath, `${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      logger.error?.(
        `[scheduled-backup] WARNING: could not write the result file ${resultFilePath}: ${sanitizeMessage(error.message)}`
      );
    }
  }

  return { exitCode, result };
}

/**
 * Print the human-readable summary and the machine-readable result line.
 *
 * @param {Record<string, any>} result
 * @param {{ log?: Function, error?: Function }} [logger]
 */
export function printResult(result, logger = console) {
  logger.log?.(`[scheduled-backup] run       ${result.runId}`);
  logger.log?.(`[scheduled-backup] directory ${result.directory}`);
  logger.log?.(
    `[scheduled-backup] backup    ${result.backup.status}${
      result.backup.archive ? ` (${result.backup.archive.name})` : ''
    }`
  );
  logger.log?.(
    `[scheduled-backup] retention ${result.retention.status}${
      result.retention.reason ? ` (${result.retention.reason})` : ''
    }`
  );
  if (result.error) {
    logger.error?.(`[scheduled-backup] FAILED: ${result.error.message}`);
  }
  logger.log?.(`[scheduled-backup] RESULT ${JSON.stringify(result)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runScheduledBackup(process.argv.slice(2))
    .then(({ exitCode, result }) => {
      if (result) printResult(result);
      process.exitCode = exitCode ?? EXIT.OK;
    })
    .catch((error) => {
      console.error(`[scheduled-backup] FAILED: ${sanitizeMessage(error.message)}`);
      process.exitCode = error.exitCode ?? EXIT.TOOL_FAILED;
    });
}
