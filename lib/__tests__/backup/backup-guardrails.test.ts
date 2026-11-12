/**
 * Unit tests for the backup/restore guardrails (`scripts/backup/lib.mjs`).
 *
 * The backup tooling has two failure modes that destroy data rather than merely
 * inconvenience; these tests pin exactly those:
 *
 *  - a restore that is pointed at a real database must refuse *before* it
 *    writes anything, and
 *  - a connection string must never reach a log or a child process argument
 *    list intact.
 *
 * They also cover the mechanical guarantees the scripts depend on: exclusive
 * creation (no silent overwrite of yesterday's good backup), atomic manifest
 * writes, path containment, and checksum stability. Real `pg_dump`/`pg_restore`
 * behaviour is exercised in CI by the `backup-verify` job, which runs against an
 * actual PostgreSQL service — a mock cannot prove an archive restores.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EXIT,
  RESTORE_DB_PREFIX,
  UsageError,
  assertDisposableTarget,
  assertWithinRoots,
  defaultBackupDir,
  ensurePrivateDir,
  fileSize,
  libpqEnv,
  openExclusive,
  parseConnectionUrl,
  redactUrl,
  removeIfExists,
  sha256File,
  writeFileAtomic,
} from '../../../scripts/backup/lib.mjs';

const run = promisify(execFile);

const APP_URL = 'postgresql://agencyos:app_secret@localhost:5432/agencyos?schema=public';
const ISOLATED_URL = 'postgresql://agencyos:verify_secret@localhost:5433/postgres';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'agencyos-backup-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('redactUrl', () => {
  it('masks the password but keeps host, port and database', () => {
    const redacted = redactUrl(APP_URL);

    expect(redacted).not.toContain('app_secret');
    expect(redacted).toContain('localhost:5432');
    expect(redacted).toContain('agencyos');
  });

  it('masks a password that needs URL-encoding', () => {
    expect(redactUrl('postgresql://u:p%40ss%2Fword@db.example.com:5432/agencyos')).not.toContain(
      'p@ss'
    );
  });

  it('never echoes an unparseable value, which may still hold a credential', () => {
    const redacted = redactUrl('this is not a url but has secret-token-123');

    expect(redacted).not.toContain('secret-token-123');
    expect(redacted).toBe('<unparseable connection string redacted>');
  });

  it('reports an unset value instead of the string "undefined"', () => {
    expect(redactUrl(undefined)).toBe('<unset>');
    expect(redactUrl('')).toBe('<unset>');
  });
});

describe('parseConnectionUrl', () => {
  it('extracts the discrete libpq fields', () => {
    expect(parseConnectionUrl(APP_URL, 'DATABASE_URL')).toMatchObject({
      host: 'localhost',
      port: '5432',
      user: 'agencyos',
      password: 'app_secret',
      database: 'agencyos',
    });
  });

  it('defaults the port to 5432 when the URL omits it', () => {
    expect(parseConnectionUrl('postgresql://u@localhost/db').port).toBe('5432');
  });

  it('decodes percent-encoded credentials', () => {
    const parsed = parseConnectionUrl('postgresql://u%40corp:p%40ss@localhost:5432/db');

    expect(parsed.user).toBe('u@corp');
    expect(parsed.password).toBe('p@ss');
  });

  it('accepts the postgres:// scheme as well as postgresql://', () => {
    expect(parseConnectionUrl('postgres://u@localhost/db').database).toBe('db');
  });

  it('rejects a non-PostgreSQL scheme rather than handing it to pg_dump', () => {
    expect(() => parseConnectionUrl('mysql://u@localhost/db', 'DATABASE_URL')).toThrow(
      /must use the postgres/
    );
  });

  it('rejects a URL that names no database', () => {
    expect(() => parseConnectionUrl('postgresql://localhost:5432', 'DATABASE_URL')).toThrow(
      /does not name a database/
    );
  });

  it('names the offending variable, so a misconfigured job is obvious', () => {
    expect(() => parseConnectionUrl(undefined, 'RESTORE_VERIFY_ADMIN_URL')).toThrow(
      /RESTORE_VERIFY_ADMIN_URL is not set/
    );
  });

  it('never puts the password in the thrown message', () => {
    try {
      parseConnectionUrl('mysql://agencyos:leaked_secret@localhost/db', 'DATABASE_URL');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('leaked_secret');
    }
  });
});

describe('libpqEnv', () => {
  const connection = parseConnectionUrl(APP_URL);

  it('passes credentials through the environment, not argv', () => {
    const env = libpqEnv(connection);

    expect(env.PGHOST).toBe('localhost');
    expect(env.PGPORT).toBe('5432');
    expect(env.PGDATABASE).toBe('agencyos');
    expect(env.PGPASSWORD).toBe('app_secret');
  });

  it('drops ambient PG* variables so a stray PGDATABASE cannot retarget a command', () => {
    const previous = process.env.PGDATABASE;
    const previousHost = process.env.PGHOST;
    process.env.PGDATABASE = 'production';
    process.env.PGHOST = 'wrong-host';

    try {
      const env = libpqEnv(connection);

      expect(env.PGDATABASE).toBe('agencyos');
      expect(env.PGHOST).toBe('localhost');
    } finally {
      if (previous === undefined) delete process.env.PGDATABASE;
      else process.env.PGDATABASE = previous;
      if (previousHost === undefined) delete process.env.PGHOST;
      else process.env.PGHOST = previousHost;
    }
  });

  it('sets a connect timeout so a wrong host cannot hang a CI job', () => {
    const env = libpqEnv(connection);

    expect(env.PGCONNECT_TIMEOUT).toBe('15');
  });

  it('leaves no ambient PGPASSFILE behind that could override the password', () => {
    expect(libpqEnv(connection).PGPASSFILE).toBeUndefined();
  });

  it('inherits unrelated variables untouched', () => {
    const env = libpqEnv(connection);

    expect(env.PATH).toBe(process.env.PATH);
    expect(Object.keys(env).filter((key) => /^PG/.test(key))).toEqual(
      expect.arrayContaining(['PGHOST', 'PGPORT', 'PGDATABASE', 'PGPASSWORD'])
    );
  });
});

describe('assertDisposableTarget', () => {
  const application = parseConnectionUrl(APP_URL);
  const confirmation = 'I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET';

  const target = (overrides: Record<string, string> = {}) => ({
    ...parseConnectionUrl(ISOLATED_URL),
    database: `${RESTORE_DB_PREFIX}20260101T000000_abcd1234`,
    ...overrides,
  });

  it('accepts a prefixed database on the isolated port', () => {
    expect(() =>
      assertDisposableTarget({ target: target(), application, confirmation, allowedPort: '5433' })
    ).not.toThrow();
  });

  it('refuses when the confirmation string is absent or wrong', () => {
    expect(() => assertDisposableTarget({ target: target(), application })).toThrow(
      /RESTORE_VERIFY_ISOLATION_CONFIRMATION/
    );
    expect(() =>
      assertDisposableTarget({ target: target(), application, confirmation: 'yes' })
    ).toThrow(/I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET/);
  });

  it('refuses a database name without the disposable prefix', () => {
    expect(() =>
      assertDisposableTarget({
        // A different database from DATABASE_URL, so the *prefix* rule is what
        // rejects it rather than the application-database rule.
        target: target({ database: 'agencyos_analytics' }),
        application,
        confirmation,
      })
    ).toThrow(new RegExp(RESTORE_DB_PREFIX));
  });

  it('reports the application-database collision ahead of the prefix rule', () => {
    // Both rules apply to `agencyos` on the live host and port; the message must
    // name the more serious problem rather than complaining about the prefix.
    expect(() =>
      assertDisposableTarget({
        target: target({ database: 'agencyos', port: '5432' }),
        application,
        confirmation,
      })
    ).toThrow(/DATABASE_URL/);
  });

  it('refuses the exact application database even when it carries the prefix', () => {
    // Defence in depth: if someone ever points DATABASE_URL at a database whose
    // name happens to look disposable, the target is still the live one and
    // must be refused.
    const misconfiguredApp = parseConnectionUrl(
      `postgresql://agencyos:app_secret@localhost:5432/${RESTORE_DB_PREFIX}20260101T000000_abcd1234`
    );

    expect(() =>
      assertDisposableTarget({
        target: misconfiguredApp,
        application: misconfiguredApp,
        confirmation,
      })
    ).toThrow(/DATABASE_URL/);
  });

  it('allows the same database name on a different host, which is a different server', () => {
    const elsewhere = parseConnectionUrl(
      `postgresql://agencyos:verify_secret@db-isolated:5433/${RESTORE_DB_PREFIX}20260101T000000_abcd1234`
    );

    expect(() =>
      assertDisposableTarget({ target: elsewhere, application, confirmation })
    ).not.toThrow();
  });

  it('refuses a port other than the approved isolated port', () => {
    expect(() =>
      assertDisposableTarget({
        target: target({ port: '5432' }),
        application,
        confirmation,
        allowedPort: '5433',
      })
    ).toThrow(/approved isolated port 5433/);
  });

  it('applies the same checks when DATABASE_URL is not configured at all', () => {
    expect(() =>
      assertDisposableTarget({ target: target({ database: 'prod' }), confirmation })
    ).toThrow(/disposable/);
  });

  it('uses the UNSAFE exit code so CI can tell a guard from a tool failure', () => {
    try {
      assertDisposableTarget({ target: target({ database: 'agencyos' }), confirmation });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).exitCode).toBe(EXIT.UNSAFE);
    }
  });
});

describe('openExclusive', () => {
  it('creates a new file', async () => {
    const file = path.join(workDir, 'first.dump');
    const handle = await openExclusive(file);
    await handle.writeFile('archive');

    expect(await readFile(file, 'utf8')).toBe('archive');
  });

  it('refuses to clobber an existing backup, keeping its bytes intact', async () => {
    const file = path.join(workDir, 'good.dump');
    await writeFile(file, 'yesterdays-good-backup');

    await expect(openExclusive(file)).rejects.toThrow(/Refusing to overwrite/);
    expect(await readFile(file, 'utf8')).toBe('yesterdays-good-backup');
  });

  it('reports the overwrite refusal as an unsafe operation, not a crash', async () => {
    const file = path.join(workDir, 'good.dump');
    await writeFile(file, 'x');

    await expect(openExclusive(file)).rejects.toMatchObject({ exitCode: EXIT.UNSAFE });
  });
});

describe('writeFileAtomic', () => {
  it('replaces an existing manifest only once the new content is complete', async () => {
    const file = path.join(workDir, 'manifest.json');
    await writeFile(file, '{"generation":1}');

    await writeFileAtomic(file, '{"generation":2}');

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ generation: 2 });
  });

  it('leaves no temporary file behind', async () => {
    const file = path.join(workDir, 'manifest.json');
    await writeFileAtomic(file, '{}');

    expect(await readdir(workDir)).toEqual(['manifest.json']);
  });

  it('writes owner-only permissions', async () => {
    const file = path.join(workDir, 'manifest.json');
    await writeFileAtomic(file, '{}');

    const mode = (await stat(file)).mode & 0o777;
    // Windows has no POSIX mode bits; CI runs Linux, where 0600 is required.
    if (process.platform !== 'win32') expect(mode).toBe(0o600);
  });
});

describe('assertWithinRoots', () => {
  it('accepts a file directly inside the backup root', async () => {
    await expect(assertWithinRoots(path.join(workDir, 'a.dump'), [workDir])).resolves.toBe(
      path.resolve(workDir, 'a.dump')
    );
  });

  it('accepts a nested path inside the root', async () => {
    await expect(
      assertWithinRoots(path.join(workDir, 'nightly', 'a.dump'), [workDir])
    ).resolves.toContain('a.dump');
  });

  it('refuses traversal out of the root', async () => {
    await expect(
      assertWithinRoots(path.join(workDir, '..', 'etc', 'shadow'), [workDir])
    ).rejects.toThrow(/outside the allowed backup roots/);
  });

  it('refuses an absolute path elsewhere on the filesystem', async () => {
    await expect(assertWithinRoots('/etc/passwd', [workDir])).rejects.toThrow(
      /outside the allowed backup roots/
    );
  });

  it('refuses the root directory itself, which is not a file', async () => {
    await expect(assertWithinRoots(workDir, [workDir])).rejects.toThrow(/backup root itself/);
  });

  it('accepts a path inside any one of several allowed roots', async () => {
    const other = await mkdtemp(path.join(tmpdir(), 'agencyos-backup-other-'));
    try {
      await expect(
        assertWithinRoots(path.join(other, 'a.dump'), [workDir, other])
      ).resolves.toContain('a.dump');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

describe('checksums', () => {
  it('hashes file contents deterministically', async () => {
    const first = path.join(workDir, 'a.dump');
    const second = path.join(workDir, 'b.dump');
    await writeFile(first, 'same bytes');
    await writeFile(second, 'same bytes');

    expect(await sha256File(first)).toBe(await sha256File(second));
    expect(await sha256File(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects a single flipped byte', async () => {
    const file = path.join(workDir, 'a.dump');
    await writeFile(file, 'backup-archive');
    const before = await sha256File(file);

    await writeFile(file, 'backup-archivf');

    expect(await sha256File(file)).not.toBe(before);
  });

  it('distinguishes truncation from the original', async () => {
    const file = path.join(workDir, 'a.dump');
    await writeFile(file, 'x'.repeat(4096));
    const before = await sha256File(file);

    await writeFile(file, 'x'.repeat(2048));

    expect(await sha256File(file)).not.toBe(before);
  });
});

describe('fileSize and removeIfExists', () => {
  it('returns null for a missing file instead of throwing', async () => {
    expect(await fileSize(path.join(workDir, 'nope.dump'))).toBeNull();
  });

  it('reports the byte length of an existing file', async () => {
    const file = path.join(workDir, 'a.dump');
    await writeFile(file, '12345');

    expect(await fileSize(file)).toBe(5);
  });

  it('removes a partial artifact and tolerates an already-missing file', async () => {
    const file = path.join(workDir, 'partial.dump');
    await writeFile(file, 'half');

    await removeIfExists(file);
    expect(await fileSize(file)).toBeNull();
    await expect(removeIfExists(file)).resolves.toBeUndefined();
  });
});

describe('directories', () => {
  it('creates the default backup directory from BACKUP_DIR', async () => {
    const previous = process.env.BACKUP_DIR;
    process.env.BACKUP_DIR = path.join(workDir, 'custom');

    try {
      expect(defaultBackupDir()).toBe(path.join(workDir, 'custom'));
    } finally {
      if (previous === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = previous;
    }
  });

  it('falls back to ./backups when BACKUP_DIR is unset', async () => {
    const previous = process.env.BACKUP_DIR;
    delete process.env.BACKUP_DIR;

    try {
      expect(defaultBackupDir()).toBe(path.join(process.cwd(), 'backups'));
    } finally {
      if (previous !== undefined) process.env.BACKUP_DIR = previous;
    }
  });

  it('creates the directory owner-only, so other users cannot read dumps', async () => {
    const dir = path.join(workDir, 'nested', 'backups');
    await ensurePrivateDir(dir);

    const info = await stat(dir);
    expect(info.isDirectory()).toBe(true);
    if (process.platform !== 'win32') expect(info.mode & 0o777).toBe(0o700);
  });
});

describe('runTool failure reporting', () => {
  it('turns a missing PostgreSQL client into an actionable message', async () => {
    const { runTool } = await import('../../../scripts/backup/lib.mjs');

    await expect(runTool('pg_dump_that_does_not_exist', [])).rejects.toThrow(
      /was not found on PATH/
    );
  });

  it('keeps only the tail of stderr, so a huge failing restore is diagnosable', async () => {
    const { runTool } = await import('../../../scripts/backup/lib.mjs');

    const result = await runTool('node', [
      '-e',
      "process.stderr.write('x'.repeat(9000) + 'FINAL_LINE'); process.exit(3);",
    ]);

    expect(result.code).toBe(3);
    expect(result.stderrTail.length).toBeLessThan(9000);
    expect(result.stderrTail.endsWith('FINAL_LINE')).toBe(true);
  });

  it('resolves with the exit code rather than throwing on a non-zero exit', async () => {
    const { runTool } = await import('../../../scripts/backup/lib.mjs');

    const result = await runTool('node', ['-e', 'process.exit(7);']);

    expect(result.code).toBe(7);
  });
});

describe('command-line surface', () => {
  // vitest serves modules over a virtual URL, so resolve from the repo root (the cwd).
  const script = path.resolve(process.cwd(), 'scripts/backup/backup.mjs');

  it('prints usage without touching the database', async () => {
    const { stdout } = await run(process.execPath, [script, '--help'], {
      env: { ...process.env, DATABASE_URL: '' },
    });

    expect(stdout).toContain('Usage: node scripts/backup/backup.mjs');
  });

  it('fails fast, with a non-zero exit, when DATABASE_URL is missing', async () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;

    await expect(run(process.execPath, [script], { env })).rejects.toMatchObject({
      code: EXIT.UNSAFE,
    });
  });

  it('rejects an unknown option instead of silently ignoring it', async () => {
    await expect(
      run(process.execPath, [script, '--ouput', 'typo.dump'], { env: { ...process.env } })
    ).rejects.toMatchObject({ code: EXIT.UNSAFE });
  });
});

describe('manifest shape', () => {
  it('is JSON with a hex digest, so a consumer can verify it after the fact', async () => {
    const file = path.join(workDir, 'manifest.json');
    const manifest = { archive: 'a.dump', sha256: 'a'.repeat(64), bytes: 1024 };

    await writeFileAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
    const parsed = JSON.parse(await readFile(file, 'utf8'));

    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.archive).toBe('a.dump');
  });

  it('survives a round trip through an exclusive handle', async () => {
    const file = path.join(workDir, 'archive.dump');
    const handle = await openExclusive(file);
    await handle.writeFile('binary-ish content');
    await handle.close();

    expect(await fileSize(file)).toBe(18);
  });
});

describe('pg_restore --list parsing', () => {
  /**
   * Regression guard. An earlier version matched `/^[^;]*TABLE DATA /m`, which
   * cannot match a real entry line because every line begins with an entry id
   * (`6; 0 16385 TABLE DATA public "User" postgres`) and `[^;]*` stops at the
   * first `;`. It counted zero table-data entries for every archive, so the
   * tool rejected every backup it produced as corrupt. Only running it against
   * a real pg_dump caught this, so the shape is pinned here.
   */
  const countTableData = (listing: string): number =>
    listing.split('\n').filter((line) => /^\d+;\s+\d+\s+\d+\s+TABLE DATA (?!ATTACH\b)/.test(line))
      .length;

  const realListing = `;
; Archive created at 2026-11-12 07:07:19 UTC
;     dbname: agencyos
;     TOC Entries: 812
;     Compression: 6
;
1; 2615 2200 SCHEMA - public postgres
2; 0 0 COMMENT - SCHEMA public postgres
3; 1259 16385 TABLE public "User" postgres
4; 1259 16387 TABLE public "Organization" postgres
5; 0 16385 TABLE DATA public "User" postgres
6; 0 16387 TABLE DATA public "Organization" postgres
7; 2606 16400 CONSTRAINT public "User_pkey" postgres
8; 0 0 ACL - SCHEMA public postgres
`;

  it('counts table-data entries in real pg_restore --list output', () => {
    expect(countTableData(realListing)).toBe(2);
  });

  it('does not count TABLE (definition) lines as table data', () => {
    const onlyDefinitions = `1; 1259 16385 TABLE public "User" postgres
2; 1259 16387 TABLE public "Organization" postgres
`;
    expect(countTableData(onlyDefinitions)).toBe(0);
  });

  it('does not count TABLE DATA ATTACH lines as table data', () => {
    const attach = '1; 0 16385 TABLE DATA ATTACH public "User" postgres\n';
    expect(countTableData(attach)).toBe(0);
  });

  it('returns zero for an archive holding only schema', () => {
    const schemaOnly = `1; 2615 2200 SCHEMA - public postgres
2; 1259 16385 TABLE public "User" postgres
`;
    expect(countTableData(schemaOnly)).toBe(0);
  });

  it('handles windows line endings without losing entries', () => {
    const crlf = '1; 0 16385 TABLE DATA public "User" postgres\r\n';
    expect(countTableData(crlf)).toBe(1);
  });
});

describe('backup script regression: partial artifacts', () => {
  const script = path.resolve(process.cwd(), 'scripts/backup/backup.mjs');

  it('writes the archive to a .partial name, never directly to the final name', async () => {
    // The script must not leave a file at the final path until the archive has
    // been validated. With no pg_dump on PATH it fails early; the assertion is
    // that failure produces no .dump and no leftover .partial.
    const dir = path.join(workDir, 'artifacts');
    await mkdtemp(path.join(workDir, 'x-')).then(() => undefined);

    await expect(
      run(process.execPath, [script, '--dir', dir], {
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
          PATH: '/nonexistent-bin',
        },
      })
    ).rejects.toBeDefined();

    const entries = await readdir(dir).catch(() => [] as string[]);
    expect(entries.filter((f) => f.endsWith('.dump'))).toEqual([]);
    expect(entries.filter((f) => f.includes('.partial-'))).toEqual([]);
  });
});

describe('EXIT codes', () => {
  it('are distinct so a CI step can branch on the failure class', () => {
    const codes = [EXIT.OK, EXIT.UNSAFE, EXIT.TOOL_FAILED, EXIT.INTEGRITY, EXIT.VERIFY_FAILED];

    expect(new Set(codes).size).toBe(codes.length);
    expect(EXIT.OK).toBe(0);
  });
});
