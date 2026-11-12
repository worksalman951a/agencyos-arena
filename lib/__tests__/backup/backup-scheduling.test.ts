/**
 * Unit tests for the scheduled backup runner and the retention pass
 * (Phase 4D / Batch 3B, `scripts/backup/scheduled-backup.mjs` and
 * `scripts/backup/retention.mjs`).
 *
 * These tests pin the behaviours that turn a backup script into something
 * safe to run unattended:
 *
 *  - a failed backup must never be followed by a retention pass, because the
 *    previous archives are then the only known-good history left;
 *  - retention may only remove archives this tooling created, may never
 *    remove the newest verified backup, may never follow a symlink and may
 *    never leave the backup directory;
 *  - two runs must not overlap;
 *  - a dry run must change nothing;
 *  - nothing that could be a credential may reach the log or the result file.
 *
 * The backup command itself is mocked here. Real `pg_dump`/`pg_restore`
 * behaviour is exercised in CI by the `backup-verify` job, which runs the
 * scheduled runner against an actual PostgreSQL service.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXIT } from '../../../scripts/backup/lib.mjs';
import {
  applyRetention,
  inspectBackupDirectory,
  planRetention,
} from '../../../scripts/backup/retention.mjs';
import { runScheduledBackup } from '../../../scripts/backup/scheduled-backup.mjs';

const run = promisify(execFile);

const APP_URL = 'postgresql://agencyos:super_secret_value@localhost:5432/agencyos?schema=public';

let workDir: string;
let backupDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'agencyos-schedule-test-'));
  backupDir = path.join(workDir, 'backups');
  await mkdir(backupDir, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/**
 * Write a backup archive plus the manifest `scripts/backup/backup.mjs` writes
 * beside it, so the retention pass sees exactly what it sees in production.
 */
async function writeBackupArchive(
  directory: string,
  options: { name?: string; createdAt?: string; bytes?: number; format?: string } = {}
): Promise<{ name: string; sha256: string; bytes: number }> {
  const createdAt = options.createdAt ?? '2026-01-01T00:00:00.000Z';
  const name = options.name ?? `agencyos-${createdAt.replace(/[:.]/g, '-')}.dump`;
  const contents = Buffer.alloc(options.bytes ?? 4096, 0x41);
  const archivePath = path.join(directory, name);
  await writeFile(archivePath, contents);

  const sha256 = createHash('sha256').update(contents).digest('hex');
  const manifest = {
    createdAt,
    label: null,
    archive: name,
    format: options.format ?? 'pg_dump custom',
    bytes: contents.length,
    sha256,
    archiveObjects: { tableData: 18 },
    source: { host: 'localhost', port: '5432', database: 'agencyos' },
    durationMs: 12,
    metadata: {},
    criticalTables: [],
  };
  await writeFile(`${archivePath}.json`, `${JSON.stringify(manifest, null, 2)}\n`);

  return { name, sha256, bytes: contents.length };
}

/**
 * A stand-in for `scripts/backup/backup.mjs`. It writes a real archive and
 * manifest into the requested directory and reports the same lines the real
 * command prints, so the runner's parsing is exercised.
 */
function fakeBackupCommand(
  options: {
    exitCode?: number;
    stderr?: string;
    create?: boolean;
    name?: string;
    createdAt?: string;
  } = {}
) {
  const calls: Array<{ directory: string; label: string | null }> = [];

  const stub = async (args: {
    directory: string;
    label: string | null;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    calls.push({ directory: args.directory, label: args.label });

    if (options.create === false || (options.exitCode ?? 0) !== 0) {
      return {
        exitCode: options.exitCode ?? 1,
        stdout: '',
        stderr: options.stderr ?? 'pg_dump failed (exit 1): connection refused\n',
      };
    }

    const createdAt = options.createdAt ?? new Date().toISOString();
    const archive = await writeBackupArchive(args.directory, {
      name: options.name,
      createdAt,
    });
    const archivePath = path.join(args.directory, archive.name);

    return {
      exitCode: 0,
      stdout: [
        '[backup] source      postgresql://agencyos:***@localhost:5432/agencyos',
        `[backup] destination ${archivePath}`,
        '[backup] archive     4096 bytes, 18 table-data entries',
        `[backup] sha256      ${archive.sha256}`,
        `[backup] manifest    ${archivePath}.json`,
        '[backup] OK',
        '',
      ].join('\n'),
      stderr: '',
    };
  };

  return { stub, calls };
}

function silentLogger() {
  return { log: () => undefined, error: () => undefined };
}

describe('scheduled backup runner', () => {
  it('runs the verified backup command and reports a structured success', async () => {
    const fake = fakeBackupCommand({ createdAt: '2026-02-02T03:04:05.000Z' });

    const outcome = await runScheduledBackup(['--dir', backupDir, '--label', 'nightly'], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    expect(outcome.exitCode).toBe(EXIT.OK);

    const result = outcome.result!;
    expect(result.status).toBe('succeeded');
    expect(result.backup.status).toBe('succeeded');
    expect(result.backup.exitCode).toBe(0);
    expect(result.backup.archive.name).toMatch(/^agencyos-.*\.dump$/);
    expect(result.backup.archive.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.retention.status).toBe('applied');
    expect(result.error).toBeNull();

    // The existing Batch 3A command is the one that is invoked.
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].directory).toBe(backupDir);
    expect(fake.calls[0].label).toBe('nightly');
  });

  it('writes the structured result to disk, without credentials', async () => {
    const fake = fakeBackupCommand();

    const outcome = await runScheduledBackup(['--dir', backupDir], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    const resultFile = path.join(backupDir, 'last-run.json');
    const written = JSON.parse(await readFile(resultFile, 'utf8'));

    expect(written.status).toBe('succeeded');
    expect(written.runId).toBe(outcome.result!.runId);
    expect(JSON.stringify(written)).not.toContain('super_secret_value');
    expect(JSON.stringify(written)).not.toContain('agencyos:super_secret_value');
    // The source is described without the user and without the password.
    expect(written.source).toEqual({ host: 'localhost', port: '5432', database: 'agencyos' });
  });

  it('reports a failed backup, keeps every archive and skips retention', async () => {
    const keeper = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const fake = fakeBackupCommand({
      exitCode: 3,
      stderr: 'pg_dump failed (exit 3): FATAL: password authentication failed\n',
    });

    const outcome = await runScheduledBackup(['--dir', backupDir, '--keep', '1'], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    expect(outcome.exitCode).toBe(EXIT.TOOL_FAILED);

    const result = outcome.result!;
    expect(result.status).toBe('failed');
    expect(result.backup.status).toBe('failed');
    expect(result.backup.lastStatus).toBe('failed');
    expect(result.retention.status).toBe('skipped');
    expect(result.retention.reason).toBe('backup_failed');
    expect(result.retention.deleted).toEqual([]);

    // The previous good archive is still there: a failed backup must not
    // cost the operator their last known-good copy.
    expect(await readdir(backupDir)).toContain(keeper.name);
  });

  it('sanitizes error information before it reaches the result', async () => {
    const fake = fakeBackupCommand({
      exitCode: 3,
      stderr: 'pg_dump failed: could not connect to postgresql://agencyos:leaked_secret@db/x\n',
    });

    const outcome = await runScheduledBackup(['--dir', backupDir], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    const serialized = JSON.stringify(outcome.result);
    expect(serialized).not.toContain('leaked_secret');
    expect(outcome.result!.error.message).toContain('***');
  });

  it('refuses to start a second run while another one holds the lock', async () => {
    const keeper = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    await writeFile(
      path.join(backupDir, '.agencyos-backup.lock'),
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`
    );

    const fake = fakeBackupCommand();
    const outcome = await runScheduledBackup(['--dir', backupDir, '--keep', '1'], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    expect(outcome.exitCode).toBe(EXIT.LOCKED);
    expect(outcome.result!.status).toBe('failed');
    expect(outcome.result!.backup.status).toBe('not-run');
    // Nothing ran and nothing was deleted.
    expect(fake.calls).toHaveLength(0);
    expect(await readdir(backupDir)).toContain(keeper.name);
  });

  it('reclaims an abandoned lock whose owner is gone', async () => {
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await writeFile(
      path.join(backupDir, '.agencyos-backup.lock'),
      `${JSON.stringify({ pid: 4194305, startedAt: stale })}\n`
    );

    const fake = fakeBackupCommand();
    const outcome = await runScheduledBackup(['--dir', backupDir], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    expect(outcome.exitCode).toBe(EXIT.OK);
    expect(outcome.result!.lock.reclaimed).toBe(true);
    // The lock is released again when the run ends.
    expect(await readdir(backupDir)).not.toContain('.agencyos-backup.lock');
  });

  it('fails safely when the destination storage is not usable', async () => {
    const notADirectory = path.join(workDir, 'a-file');
    await writeFile(notADirectory, 'not a directory');

    const fake = fakeBackupCommand();
    const outcome = await runScheduledBackup(['--dir', notADirectory], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    expect(outcome.exitCode).toBe(EXIT.STORAGE);
    expect(outcome.result!.status).toBe('failed');
    expect(fake.calls).toHaveLength(0);
  });

  it('refuses to run without a source database', async () => {
    const outcome = await runScheduledBackup(['--dir', backupDir], {
      runBackup: fakeBackupCommand().stub,
      logger: silentLogger(),
      env: {},
    });

    expect(outcome.exitCode).toBe(EXIT.UNSAFE);
    expect(outcome.result!.error.message).toMatch(/DATABASE_URL/);
  });

  it('rejects an unusable retention count instead of guessing', async () => {
    const outcome = await runScheduledBackup(['--dir', backupDir, '--keep', '0'], {
      runBackup: fakeBackupCommand().stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    expect(outcome.exitCode).toBe(EXIT.UNSAFE);
    expect(outcome.result!.error.message).toMatch(/positive integer/);
  });

  it('leaves a result file behind even when the configuration is wrong', async () => {
    const outcome = await runScheduledBackup(['--dir', backupDir], {
      runBackup: fakeBackupCommand().stub,
      logger: silentLogger(),
      env: {},
    });

    expect(outcome.exitCode).toBe(EXIT.UNSAFE);

    const written = JSON.parse(await readFile(path.join(backupDir, 'last-run.json'), 'utf8'));
    expect(written.status).toBe('failed');
    expect(written.error.message).toMatch(/DATABASE_URL/);
  });

  it('still reports to the webhook when the backup cannot run', async () => {
    const delivered: Array<{
      url: string;
      token: string | null;
      payload: Record<string, unknown>;
    }> = [];

    const outcome = await runScheduledBackup(['--dir', backupDir], {
      runBackup: fakeBackupCommand().stub,
      logger: silentLogger(),
      env: { BACKUP_HOOK_URL: 'https://hooks.example.test/backup' },
      sendHook: async (url: string, token: string | null, payload: Record<string, unknown>) => {
        delivered.push({ url, token, payload });
        return { ok: true, status: 200 };
      },
    });

    expect(outcome.exitCode).toBe(EXIT.UNSAFE);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].url).toBe('https://hooks.example.test/backup');
    expect(delivered[0].payload.status).toBe('failed');
    expect((delivered[0].payload.error as { message: string }).message).toMatch(/DATABASE_URL/);
  });

  it('refuses a webhook URL that is not http(s)', async () => {
    const outcome = await runScheduledBackup(
      ['--dir', backupDir, '--hook-url', 'file:///etc/passwd'],
      {
        runBackup: fakeBackupCommand().stub,
        logger: silentLogger(),
        env: { DATABASE_URL: APP_URL },
      }
    );

    expect(outcome.exitCode).toBe(EXIT.UNSAFE);
    expect(outcome.result!.error.message).toMatch(/http or https/);
  });

  it('never puts the webhook token or its query string in the result', async () => {
    const outcome = await runScheduledBackup(
      ['--dir', backupDir, '--hook-url', 'https://hooks.example.test/backup?token=url_secret'],
      {
        runBackup: fakeBackupCommand().stub,
        logger: silentLogger(),
        env: { DATABASE_URL: APP_URL, BACKUP_HOOK_TOKEN: 'header_secret' },
        sendHook: async () => ({ ok: true, status: 200 }),
      }
    );

    const serialized = JSON.stringify(outcome.result);
    expect(serialized).not.toContain('url_secret');
    expect(serialized).not.toContain('header_secret');
    expect(outcome.result!.hook.url).toBe('https://hooks.example.test/backup');
  });
});

describe('retention', () => {
  it('keeps the newest verified backups and expires the rest', async () => {
    const old = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const middle = await writeBackupArchive(backupDir, { createdAt: '2026-01-02T00:00:00.000Z' });
    const newest = await writeBackupArchive(backupDir, { createdAt: '2026-01-03T00:00:00.000Z' });

    const inspection = await inspectBackupDirectory(backupDir);
    expect(inspection.verified.map((entry) => entry.name)).toHaveLength(3);

    const plan = planRetention(inspection.verified, { keep: 2 });
    expect(plan.keep.map((entry) => entry.name)).toEqual([newest.name, middle.name]);
    expect(plan.delete.map((entry) => entry.name)).toEqual([old.name]);
  });

  it('never deletes the newest verified backup, whatever the policy says', async () => {
    const oldest = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const newest = await writeBackupArchive(backupDir, { createdAt: '2026-01-02T00:00:00.000Z' });

    const inspection = await inspectBackupDirectory(backupDir);
    const plan = planRetention(inspection.verified, { keep: 0 });

    expect(plan.delete.map((entry) => entry.name)).toEqual([oldest.name]);
    expect(plan.delete.map((entry) => entry.name)).not.toContain(newest.name);
  });

  it('leaves unrelated files alone', async () => {
    const keeper = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const unrelated = path.join(backupDir, 'notes.txt');
    await writeFile(unrelated, 'operator notes');

    const inspection = await inspectBackupDirectory(backupDir);
    expect(inspection.unrelated).toContain('notes.txt');

    const plan = planRetention(inspection.verified, { keep: 1 });
    const outcome = await applyRetention(plan, { directory: backupDir });

    expect(outcome.deleted).toEqual([]);
    expect(await readFile(unrelated, 'utf8')).toBe('operator notes');
    expect(await readdir(backupDir)).toContain(keeper.name);
  });

  it('never deletes a backup that is still being written', async () => {
    const keeper = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const partial = path.join(
      backupDir,
      'agencyos-2026-01-02T00-00-00-000Z.dump.partial-4321-deadbeef'
    );
    await writeFile(partial, 'half a dump');

    const inspection = await inspectBackupDirectory(backupDir);
    expect(inspection.partials).toHaveLength(1);
    expect(inspection.verified.map((entry) => entry.name)).toEqual([keeper.name]);

    const plan = planRetention(inspection.verified, { keep: 1 });
    const outcome = await applyRetention(plan, { directory: backupDir });

    expect(outcome.deleted).toEqual([]);
    expect(await readFile(partial, 'utf8')).toBe('half a dump');
  });

  it('refuses to delete an archive whose manifest does not describe it', async () => {
    const archive = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    // A manifest for a different archive: this pairing is not ours.
    const manifestPath = path.join(backupDir, `${archive.name}.json`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.archive = 'agencyos-somebody-elses.dump';
    await writeFile(manifestPath, JSON.stringify(manifest));

    const inspection = await inspectBackupDirectory(backupDir);
    expect(inspection.verified).toHaveLength(0);
    expect(inspection.skipped[0]).toEqual({ name: archive.name, reason: 'manifest_mismatch' });

    const plan = planRetention(inspection.verified, { keep: 1 });
    const outcome = await applyRetention(plan, { directory: backupDir });

    expect(outcome.deleted).toEqual([]);
    expect(await readdir(backupDir)).toContain(archive.name);
  });

  it('refuses to delete an archive whose size no longer matches its manifest', async () => {
    const archive = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    await writeFile(path.join(backupDir, archive.name), 'truncated');

    const inspection = await inspectBackupDirectory(backupDir);
    expect(inspection.verified).toHaveLength(0);
    expect(inspection.skipped[0].reason).toBe('size_mismatch');
  });

  it('refuses to delete an archive that is not in pg_dump custom format', async () => {
    await writeBackupArchive(backupDir, {
      createdAt: '2026-01-01T00:00:00.000Z',
      format: 'SQL text',
    });

    const inspection = await inspectBackupDirectory(backupDir);
    expect(inspection.verified).toHaveLength(0);
    expect(inspection.skipped[0].reason).toBe('unexpected_format');
  });

  it('never follows a symlink out of the backup directory', async () => {
    const outside = path.join(workDir, 'outside.dump');
    await writeFile(outside, 'precious data');

    const linkName = 'agencyos-2026-01-01T00-00-00-000Z.dump';
    await symlink(outside, path.join(backupDir, linkName));
    await writeFile(
      path.join(backupDir, `${linkName}.json`),
      `${JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        archive: linkName,
        format: 'pg_dump custom',
        bytes: 13,
        sha256: 'a'.repeat(64),
      })}\n`
    );

    const inspection = await inspectBackupDirectory(backupDir);
    expect(inspection.verified).toHaveLength(0);
    expect(inspection.skipped[0]).toEqual({ name: linkName, reason: 'symlink' });

    const plan = planRetention(inspection.verified, { keep: 1 });
    const outcome = await applyRetention(plan, { directory: backupDir });

    expect(outcome.deleted).toEqual([]);
    expect(await readFile(outside, 'utf8')).toBe('precious data');
  });

  it('never deletes anything outside the configured backup directory', async () => {
    const outsideDir = path.join(workDir, 'elsewhere');
    await mkdir(outsideDir, { recursive: true });
    const outside = await writeBackupArchive(outsideDir, {
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await writeBackupArchive(backupDir, { createdAt: '2026-01-02T00:00:00.000Z' });

    const inspection = await inspectBackupDirectory(backupDir);
    const plan = planRetention(inspection.verified, { keep: 1 });
    const outcome = await applyRetention(plan, { directory: backupDir });

    expect(outcome.deleted).toEqual([]);
    expect(await readdir(outsideDir)).toContain(outside.name);
  });

  it('deletes nothing in dry-run mode but reports what it would do', async () => {
    const old = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const newest = await writeBackupArchive(backupDir, { createdAt: '2026-01-02T00:00:00.000Z' });

    const inspection = await inspectBackupDirectory(backupDir);
    const plan = planRetention(inspection.verified, { keep: 1 });
    const outcome = await applyRetention(plan, { directory: backupDir, dryRun: true });

    expect(outcome.deleted).toEqual([]);
    expect(outcome.planned.map((item) => item.name)).toEqual([old.name]);
    expect(await readdir(backupDir)).toContain(old.name);
    expect(await readdir(backupDir)).toContain(newest.name);
  });
});

describe('retention through the runner', () => {
  it('applies the retention policy after a successful backup', async () => {
    const old = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const fake = fakeBackupCommand({ createdAt: '2026-01-05T00:00:00.000Z' });

    const outcome = await runScheduledBackup(['--dir', backupDir, '--keep', '1'], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    expect(outcome.exitCode).toBe(EXIT.OK);
    expect(outcome.result!.retention.status).toBe('applied');
    expect(outcome.result!.retention.deleted).toEqual([old.name]);
    expect(await readdir(backupDir)).not.toContain(old.name);
    // The archive the run just produced survives.
    expect(await readdir(backupDir)).toContain(outcome.result!.backup.archive.name);
  });

  it('changes nothing in dry-run mode', async () => {
    const old = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const fake = fakeBackupCommand({ createdAt: '2026-01-05T00:00:00.000Z' });

    const outcome = await runScheduledBackup(['--dir', backupDir, '--keep', '1', '--dry-run'], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    expect(outcome.exitCode).toBe(EXIT.OK);
    expect(outcome.result!.retention.status).toBe('dry-run');
    expect(outcome.result!.retention.planned).toEqual([old.name]);
    expect(outcome.result!.retention.deleted).toEqual([]);
    expect(await readdir(backupDir)).toContain(old.name);
  });

  it('keeps the newest verified backup when the policy expires the rest', async () => {
    const oldest = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const middle = await writeBackupArchive(backupDir, { createdAt: '2026-01-02T00:00:00.000Z' });
    const fake = fakeBackupCommand({ createdAt: '2026-01-03T00:00:00.000Z' });

    const outcome = await runScheduledBackup(['--dir', backupDir, '--keep', '1'], {
      runBackup: fake.stub,
      logger: silentLogger(),
      env: { DATABASE_URL: APP_URL },
    });

    const newest = outcome.result!.backup.archive.name;
    expect(outcome.result!.retention.deleted.sort()).toEqual([oldest.name, middle.name].sort());
    const remaining = await readdir(backupDir);
    expect(remaining).toContain(newest);
    expect(remaining).not.toContain(oldest.name);
    expect(remaining).not.toContain(middle.name);
  });

  it('refuses to prune after the last backup failed', async () => {
    const keeper = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });

    // A previous run that failed leaves its result behind.
    await writeFile(
      path.join(backupDir, 'last-run.json'),
      JSON.stringify({
        tool: 'agencyos-scheduled-backup',
        status: 'failed',
        backup: { status: 'failed', lastStatus: 'failed' },
      })
    );

    const outcome = await runScheduledBackup(
      ['--dir', backupDir, '--retention-only', '--keep', '1'],
      {
        runBackup: fakeBackupCommand().stub,
        logger: silentLogger(),
        env: { DATABASE_URL: APP_URL },
      }
    );

    expect(outcome.exitCode).toBe(EXIT.OK);
    expect(outcome.result!.status).toBe('skipped');
    expect(outcome.result!.retention.status).toBe('skipped');
    expect(outcome.result!.retention.reason).toBe('latest_backup_failed');
    expect(await readdir(backupDir)).toContain(keeper.name);
  });

  it('prunes in retention-only mode when the last backup succeeded', async () => {
    const old = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    await writeBackupArchive(backupDir, { createdAt: '2026-01-02T00:00:00.000Z' });
    await writeFile(
      path.join(backupDir, 'last-run.json'),
      JSON.stringify({
        tool: 'agencyos-scheduled-backup',
        status: 'succeeded',
        backup: { status: 'succeeded', lastStatus: 'succeeded' },
      })
    );

    const outcome = await runScheduledBackup(
      ['--dir', backupDir, '--retention-only', '--keep', '1'],
      {
        runBackup: fakeBackupCommand().stub,
        logger: silentLogger(),
        env: { DATABASE_URL: APP_URL },
      }
    );

    expect(outcome.exitCode).toBe(EXIT.OK);
    expect(outcome.result!.retention.status).toBe('applied');
    expect(outcome.result!.retention.deleted).toEqual([old.name]);
  });
});

describe('Batch 3A compatibility', () => {
  it('drives the existing backup command rather than a second implementation', () => {
    const script = path.resolve(process.cwd(), 'scripts/backup/backup.mjs');
    expect(existsSync(script)).toBe(true);

    const source = readFileSync(script, 'utf8');
    // The Batch 3A guarantees the runner depends on are still in place.
    expect(source).toContain('--serializable-deferrable');
    expect(source).toContain('writeFileAtomic');
  });

  it('understands the manifest written by the Batch 3A backup command', async () => {
    const archive = await writeBackupArchive(backupDir, { createdAt: '2026-01-01T00:00:00.000Z' });
    const manifest = JSON.parse(
      await readFile(path.join(backupDir, `${archive.name}.json`), 'utf8')
    );

    expect(manifest.format).toBe('pg_dump custom');
    expect(manifest.archive).toBe(archive.name);
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);

    const inspection = await inspectBackupDirectory(backupDir);
    expect(inspection.verified.map((entry) => entry.name)).toEqual([archive.name]);
  });

  it('keeps the shared exit-code vocabulary distinct', async () => {
    const codes = [
      EXIT.OK,
      EXIT.UNSAFE,
      EXIT.TOOL_FAILED,
      EXIT.INTEGRITY,
      EXIT.VERIFY_FAILED,
      EXIT.LOCKED,
      EXIT.STORAGE,
    ];
    expect(new Set(codes).size).toBe(codes.length);
    expect(EXIT.OK).toBe(0);
  });
});

describe('command-line surface', () => {
  const script = path.resolve(process.cwd(), 'scripts/backup/scheduled-backup.mjs');

  it('prints usage without touching the database', async () => {
    const { stdout } = await run(process.execPath, [script, '--help'], {
      env: { ...process.env, DATABASE_URL: '' },
    });

    expect(stdout).toContain('Usage: node scripts/backup/scheduled-backup.mjs');
  });

  it('rejects an unknown option instead of silently ignoring it', async () => {
    await expect(
      run(process.execPath, [script, '--ouput', 'typo.dump'], { env: { ...process.env } })
    ).rejects.toMatchObject({ code: EXIT.UNSAFE });
  });

  it('exits 2 when the source database is not configured', async () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;

    await expect(run(process.execPath, [script], { env })).rejects.toMatchObject({
      code: EXIT.UNSAFE,
    });
  });
});
