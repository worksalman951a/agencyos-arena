#!/usr/bin/env node
/**
 * Create a consistent, verified PostgreSQL backup of the AgencyOS database.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/backup/backup.mjs
 *   DATABASE_URL=... node scripts/backup/backup.mjs --output backups/agencyos.dump
 *
 * Output (both files, owner-only permissions):
 *   <name>.dump    pg_dump custom-format archive (the backup)
 *   <name>.json    manifest: sha256, size, PostgreSQL version, table list, counts
 *
 * Guarantees, in the order they are enforced:
 *  1. **Never overwrites.** The archive is opened with `wx`; an existing path is
 *     a hard error unless `--force-replace` is passed deliberately.
 *  2. **Never publishes data.** Progress and summary lines contain file names,
 *     sizes, checksums and counts only — never row contents, never the DSN.
 *  3. **Never leaves a bad archive that looks good.** The dump is written to a
 *     temporary file, validated (`pg_restore --list`, archive header, object
 *     count) and only then renamed into place. Any failure removes the
 *     temporary file and exits non-zero, so a consumer never sees a partial
 *     backup under the real name.
 *  4. **Consistent point-in-time snapshot.** `pg_dump` runs inside a single
 *     serializable-deferrable transaction (`--serializable-deferrable`), so the
 *     archive reflects one consistent state even while the application writes.
 *
 * Credentials: the password travels to `pg_dump` via `PGPASSWORD` in the child
 * environment, never on the command line (invisible to `ps`) and never printed.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';

import {
  EXIT,
  UsageError,
  assertWithinRoots,
  defaultBackupDir,
  ensurePrivateDir,
  fileSize,
  libpqEnv,
  openExclusive,
  parseConnectionUrl,
  redactUrl,
  removeIfExists,
  runTool,
  sha256File,
  writeFileAtomic,
} from './lib.mjs';

const SCHEMA_TABLES = [
  'User',
  'Session',
  'Organization',
  'Role',
  'Permission',
  'Invitation',
  'Contact',
  'AgencyAccount',
  'Pipeline',
  'Opportunity',
  'Invoice',
  'Payment',
  'Project',
  'Task',
  'Document',
  'ClientAccess',
  'ClientInvitation',
  'RateLimitBucket',
];

function usage() {
  return `Usage: node scripts/backup/backup.mjs [options]

Options:
  --output <path>    Archive path. Default: <BACKUP_DIR>/agencyos-<timestamp>.dump
  --dir <path>       Backup directory. Default: $BACKUP_DIR or ./backups
  --force-replace    Allow replacing an existing archive at --output
  --label <text>     Free-form label recorded in the manifest (no secrets)
  --help             Show this message

Environment:
  DATABASE_URL       Source database (required)
  BACKUP_DIR         Default backup directory
  PGHOST/PGPORT/...  pg_dump on PATH; version must be >= the server version
`;
}

function parseArgs(argv) {
  const options = { forceReplace: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--output':
        options.output = argv[++index];
        break;
      case '--dir':
        options.dir = argv[++index];
        break;
      case '--label':
        options.label = argv[++index];
        break;
      case '--force-replace':
        options.forceReplace = true;
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

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
}

/**
 * Read the metadata the manifest needs: server version, migration state and
 * per-table row counts.
 *
 * This runs as a separate read-only `psql` invocation *after* the dump. It is
 * best-effort: a backup that succeeded must not be discarded because a
 * metadata query failed, so a failure is recorded in the manifest instead.
 */
async function collectMetadata(connection) {
  // Counts are EXACT, not pg_stat_user_tables.n_live_tup: that column is a
  // planner estimate that stays 0 until autovacuum or ANALYZE touches a table,
  // and in a freshly restored database it is always 0. Comparing estimates
  // against estimates would make the restore check pass on an empty restore.
  const query = `
    SELECT json_build_object(
      'serverVersion', current_setting('server_version'),
      'database', current_database(),
      'migrations', COALESCE((
        SELECT json_build_object('applied', COUNT(*), 'latest', MAX(migration_name))
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ), json_build_object('applied', 0, 'latest', null)),
      'tables', (
        SELECT json_agg(json_build_object('table', t, 'rows', c) ORDER BY t)
        FROM (
          SELECT c.relname AS t,
                 (xpath('/row/c/text()',
                   query_to_xml(
                     format('SELECT count(*) AS c FROM public.%I', c.relname),
                     false, true, '')))[1]::text::bigint AS c
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
        ) exact
      )
    )::text;
  `;

  const chunks = [];
  const result = await runTool(
    'psql',
    ['-X', '-q', '-At', '-w', '-v', 'ON_ERROR_STOP=1', '-c', query],
    {
      env: libpqEnv(connection),
      stdout: (stream) => stream.on('data', (chunk) => chunks.push(chunk)),
    }
  );

  if (result.code !== 0) {
    return { error: 'metadata query failed', stderrTail: result.stderrTail };
  }

  try {
    return JSON.parse(chunks.join('').trim());
  } catch {
    return { error: 'metadata response was not valid JSON' };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return EXIT.OK;
  }

  const connection = parseConnectionUrl(process.env.DATABASE_URL, 'DATABASE_URL');
  const backupDir = await ensurePrivateDir(options.dir ?? defaultBackupDir());

  const baseName = `agencyos-${timestamp()}`;
  const outputPath = options.output
    ? await assertWithinRoots(options.output, [backupDir])
    : path.join(backupDir, `${baseName}.dump`);
  const manifestPath = `${outputPath}.json`;

  // Fail before doing any work if the target name is taken.
  if (!options.forceReplace) {
    const existing = await fileSize(outputPath);
    if (existing !== null) {
      throw new UsageError(
        `Refusing to overwrite an existing backup: ${outputPath} (${existing} bytes). ` +
          'Use a new --output name, or --force-replace once you are sure it is expendable.'
      );
    }
  }

  const tempPath = `${outputPath}.partial-${process.pid}-${randomBytes(4).toString('hex')}`;

  console.log(`[backup] source      ${redactUrl(process.env.DATABASE_URL)}`);
  console.log(`[backup] destination ${outputPath}`);

  // ---------------------------------------------------------------------------
  // 1. Dump into a temporary file.
  // ---------------------------------------------------------------------------
  const startedAt = Date.now();
  let dumpExit;
  try {
    // `wx`: a stale partial file from a killed previous run is a real error,
    // not something to truncate silently.
    const handle = await openExclusive(tempPath);
    await handle.close();

    const sink = createWriteStream(tempPath, { mode: 0o600 });
    dumpExit = await runTool(
      'pg_dump',
      [
        '--format=custom',
        '--compress=6',
        // One consistent snapshot; waits for a safe point rather than
        // serializing against live writers.
        '--serializable-deferrable',
        '--no-password',
        '--verbose',
      ],
      {
        env: libpqEnv(connection),
        stdout: (stream) => {
          stream.pipe(sink);
        },
      }
    ).then(async (result) => {
      await new Promise((resolve, reject) => {
        sink.on('finish', resolve);
        sink.on('error', reject);
      });
      return result;
    });

    if (dumpExit.code !== 0) {
      throw Object.assign(
        new Error(`pg_dump failed (exit ${dumpExit.code}): ${dumpExit.stderrTail.trim()}`),
        { exitCode: EXIT.TOOL_FAILED }
      );
    }
  } catch (error) {
    // A failed run must never leave something that looks like a backup.
    await removeIfExists(tempPath);
    throw error;
  }

  try {
    // -------------------------------------------------------------------------
    // 2. Validate the archive before it is given its real name.
    // -------------------------------------------------------------------------
    const size = await fileSize(tempPath);
    if (!size || size < 1024) {
      throw Object.assign(
        new Error(`Dump is implausibly small (${size ?? 0} bytes); treating it as corrupt.`),
        { exitCode: EXIT.INTEGRITY }
      );
    }

    const listChunks = [];
    const listResult = await runTool('pg_restore', ['--list', tempPath], {
      stdout: (stream) => stream.on('data', (chunk) => listChunks.push(chunk)),
    });
    if (listResult.code !== 0) {
      throw Object.assign(
        new Error(`pg_restore --list rejected the archive: ${listResult.stderrTail.trim()}`),
        { exitCode: EXIT.INTEGRITY }
      );
    }

    const listing = Buffer.concat(listChunks).toString('utf8');
    const tableCount = (listing.match(/^[^;]*TABLE DATA /gm) ?? []).length;
    if (tableCount === 0) {
      throw Object.assign(
        new Error(
          'Archive contains no table data; refusing to publish a backup that restores nothing.'
        ),
        { exitCode: EXIT.INTEGRITY }
      );
    }

    // -------------------------------------------------------------------------
    // 3. Publish: checksum, rename, manifest.
    // -------------------------------------------------------------------------
    const sha256 = await sha256File(tempPath);
    const { rename } = await import('node:fs/promises');
    await rename(tempPath, outputPath);

    const metadata = await collectMetadata(connection);
    const manifest = {
      createdAt: new Date().toISOString(),
      label: options.label ?? null,
      archive: path.basename(outputPath),
      format: 'pg_dump custom',
      bytes: size,
      sha256,
      archiveObjects: { tableData: tableCount },
      source: {
        host: connection.host,
        port: connection.port,
        database: connection.database,
        // Never the user, never the password.
      },
      durationMs: Date.now() - startedAt,
      metadata,
      // The tables the restore verifier insists on finding.
      criticalTables: SCHEMA_TABLES,
    };
    await writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(`[backup] archive     ${size} bytes, ${tableCount} table-data entries`);
    console.log(`[backup] sha256      ${sha256}`);
    console.log(`[backup] manifest    ${manifestPath}`);
    console.log(`[backup] duration    ${manifest.durationMs} ms`);
    console.log('[backup] OK');
    return EXIT.OK;
  } catch (error) {
    await removeIfExists(tempPath);
    throw error;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code ?? EXIT.OK;
    })
    .catch((error) => {
      const code =
        error instanceof UsageError ? error.exitCode : (error.exitCode ?? EXIT.TOOL_FAILED);
      console.error(`[backup] FAILED: ${error.message}`);
      process.exitCode = code;
    });
}

export { main };
