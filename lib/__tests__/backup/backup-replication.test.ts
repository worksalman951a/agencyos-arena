import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Encrypter } from 'age-encryption';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadKey, recover, replicate } from '../../../scripts/backup/replication.mjs';
import { runScheduledBackup } from '../../../scripts/backup/scheduled-backup.mjs';

let previousPath: string | undefined;
const key = 'ab'.repeat(32);
const name = 'agencyos-test.dump';
let root: string, local: string, dest: string, temp: string, archive: string;
const data = Buffer.alloc(4096, 'confidential fixture data, never upload plaintext');
async function fixture(contents = data) {
  await writeFile(archive, contents, { mode: 0o600 });
  await writeFile(
    `${archive}.json`,
    JSON.stringify({
      archive: name,
      format: 'pg_dump custom',
      bytes: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex'),
      archiveObjects: { tableData: 1 },
      metadata: { tables: [] },
    }),
    { mode: 0o600 }
  );
}
const upload = () => replicate({ archive, destination: dest, key });
const restore = (k = key, verify?: (archive: string) => Promise<void>) =>
  recover({ name, destination: dest, tempDir: temp, key: k, verify });
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'replica-test-'));
  local = path.join(root, 'local');
  dest = path.join(root, 'replicas');
  temp = path.join(root, 'temp');
  await Promise.all([local, dest, temp].map((p) => mkdir(p, { mode: 0o700 })));
  archive = path.join(local, name);
  await fixture();
  previousPath = process.env.PATH;
  const bin = path.join(root, 'bin');
  await mkdir(bin, { mode: 0o700 });
  await writeFile(
    path.join(bin, 'pg_restore'),
    "#!/bin/sh\nprintf '6; 0 123 TABLE DATA public fixture owner\\n'\n",
    { mode: 0o700 }
  );
  process.env.PATH = `${bin}:${previousPath}`;
});
afterEach(async () => {
  process.env.PATH = previousPath;
  await rm(root, { force: true, recursive: true });
});

describe('encrypted replication', () => {
  it('encrypts and authenticates archive and manifest, and cleans recovered plaintext', async () => {
    expect((await upload()).status).toBe('uploaded');
    const encrypted = await readFile(path.join(dest, `${name}.age`));
    expect(encrypted.includes(data)).toBe(false);
    expect(encrypted.includes(Buffer.from('metadata'))).toBe(false);
    let seen = false;
    expect(
      (
        await restore(key, async (p) => {
          seen = true;
          expect(await readFile(p)).toEqual(data);
          expect(JSON.parse(await readFile(`${p}.json`, 'utf8')).archive).toBe(name);
        })
      ).status
    ).toBe('restore-verified');
    expect(seen).toBe(true);
    expect(await readdir(temp)).toEqual([]);
  }, 30000);
  it('rejects wrong keys and tampering, leaving no plaintext', async () => {
    await upload();
    await expect(restore('cd'.repeat(32))).rejects.toThrow();
    const p = path.join(dest, `${name}.age`);
    const bytes = await readFile(p);
    bytes[bytes.length - 3] ^= 1;
    await writeFile(p, bytes);
    await expect(restore()).rejects.toThrow();
    expect(await readdir(temp)).toEqual([]);
  }, 30000);
  it('rejects an authenticated payload whose manifest checksum does not match', async () => {
    const manifest = JSON.parse(await readFile(`${archive}.json`, 'utf8'));
    manifest.sha256 = '00'.repeat(32);
    const metadata = Buffer.from(JSON.stringify(manifest));
    const size = Buffer.alloc(4);
    size.writeUInt32BE(metadata.length);
    const enc = new Encrypter();
    enc.setPassphrase(key);
    const ciphertext = await enc.encrypt(Buffer.concat([size, metadata, data]));
    await writeFile(path.join(dest, `${name}.age`), ciphertext);
    await expect(restore()).rejects.toThrow();
    expect(await readdir(temp)).toEqual([]);
  }, 30000);
  it('fails closed for missing, malformed, ambiguous or exposed keys', async () => {
    await expect(loadKey({})).rejects.toThrow();
    await expect(loadKey({ BACKUP_REPLICATION_KEY: 'bad' })).rejects.toThrow();
    await expect(
      loadKey({ BACKUP_REPLICATION_KEY: key, BACKUP_REPLICATION_KEY_FILE: '/x' })
    ).rejects.toThrow();
    const f = path.join(root, 'key');
    await writeFile(f, key, { mode: 0o600 });
    expect(await loadKey({ BACKUP_REPLICATION_KEY_FILE: f })).toBe(key);
    await chmod(f, 0o644);
    await expect(loadKey({ BACKUP_REPLICATION_KEY_FILE: f })).rejects.toThrow();
  });
  it('refuses traversal, symlink roots, unsafe permissions and overlapping destinations', async () => {
    await expect(replicate({ archive, destination: local, key })).rejects.toThrow();
    await expect(
      recover({ name: '../escape.dump', destination: dest, tempDir: temp, key })
    ).rejects.toThrow();
    const link = path.join(root, 'link');
    await symlink(dest, link);
    await expect(replicate({ archive, destination: link, key })).rejects.toThrow();
    await chmod(dest, 0o777);
    await expect(upload()).rejects.toThrow();
  });
  it('is idempotent but refuses a different archive or manifest under the same name', async () => {
    const first = await upload();
    const retry = await upload();
    expect(retry.status).toBe('already-present');
    expect(retry.sha256).toBe(first.sha256);
    await fixture(Buffer.alloc(4096, 'different content'));
    await expect(upload()).rejects.toThrow();
    expect(await readFile(path.join(dest, `${name}.age`))).not.toContain('different content');
  }, 30000);
  it('rejects invalid checksums and incomplete backups without publishing; retries safely', async () => {
    const manifest = await readFile(`${archive}.json`);
    await writeFile(archive, Buffer.alloc(data.length));
    await expect(upload()).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]);
    await writeFile(archive, data);
    await rm(`${archive}.json`);
    await expect(upload()).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]);
    await writeFile(`${archive}.json`, manifest);
    await writeFile(path.join(dest, '.partial-orphan.age'), 'incomplete ciphertext');
    expect((await upload()).status).toBe('uploaded');
    expect((await restore()).status).toBe('integrity-verified');
  }, 30000);
  it('recovers from an interrupted partial upload without exposing plaintext', async () => {
    await fixture(Buffer.alloc(32 * 1024 * 1024, 0x41));
    const child = spawn(
      process.execPath,
      [path.resolve('scripts/backup/replicate.mjs'), 'upload', '--backup', archive],
      {
        env: { ...process.env, BACKUP_REPLICATION_DIR: dest, BACKUP_REPLICATION_KEY: key },
        stdio: 'ignore',
      }
    );
    const exited = new Promise<number | null>((resolve) =>
      child.on('exit', (code) => resolve(code))
    );
    let partial: string | undefined;
    try {
      for (let i = 0; i < 1000; i++) {
        partial = (await readdir(dest)).find((file) => file.startsWith('.partial-'));
        if (partial || child.exitCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(partial).toBeDefined();
      child.kill('SIGKILL');
      await exited;
      expect(await readdir(dest)).not.toContain(`${name}.age`);
      const encryptedPartial = await readFile(path.join(dest, partial!));
      expect(encryptedPartial.includes(Buffer.alloc(128, 0x41))).toBe(false);
      expect((await upload()).status).toBe('uploaded');
      expect((await restore()).status).toBe('integrity-verified');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  }, 60000);
  it('refuses an archive that pg_restore cannot validate', async () => {
    await writeFile(path.join(root, 'bin', 'pg_restore'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    await expect(upload()).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]);
  });
  it('refuses a destination symlink and never overwrites its target', async () => {
    const outside = path.join(root, 'outside');
    await writeFile(outside, 'untouched');
    await symlink(outside, path.join(dest, `${name}.age`));
    await expect(upload()).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('untouched');
  });
  it('retention-only refuses pruning after an earlier replication failure', async () => {
    await writeFile(
      path.join(local, 'last-run.json'),
      JSON.stringify({
        tool: 'agencyos-scheduled-backup',
        backup: { lastStatus: 'succeeded' },
        replication: { status: 'failed' },
      })
    );
    const result = await runScheduledBackup(['--dir', local, '--retention-only', '--keep', '1'], {
      env: {},
      logger: { log() {}, error() {} },
    });
    expect(result.result!.retention.status).toBe('skipped');
    expect(result.result!.retention.reason).toBe('latest_replication_failed');
    expect(await readFile(archive)).toEqual(data);
    const again = await runScheduledBackup(['--dir', local, '--retention-only', '--keep', '1'], {
      env: {},
      logger: { log() {}, error() {} },
    });
    expect(again.result!.retention.reason).toBe('latest_replication_failed');
  });
  it('preserves local history and reports backup separately after replication failure', async () => {
    const result = await runScheduledBackup(['--dir', local, '--keep', '1'], {
      env: { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', BACKUP_REPLICATION_DIR: dest },
      logger: { log() {}, error() {} },
      runBackup: async () => ({
        exitCode: 0,
        stdout: `[backup] destination ${archive}\n`,
        stderr: '',
      }),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.result!.backup.status).toBe('succeeded');
    expect(result.result!.replication.status).toBe('failed');
    expect(result.result!.retention.reason).toBe('replication_failed');
    expect(await readFile(archive)).toEqual(data);
  });
});
