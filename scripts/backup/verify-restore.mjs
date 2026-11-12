#!/usr/bin/env node
/**
 * Restore a backup into an isolated disposable database and verify the data.
 *
 * A successful `pg_dump` proves nothing: the archive could be empty, truncated,
 * structurally valid but missing indexes, or restore only halfway. This script
 * closes that loop by restoring into a **new, uniquely named, disposable**
 * database and then checking the recovered data against the manifest.
 *
 * Usage:
 *   RESTORE_VERIFY_ADMIN_URL=postgresql://user:pw@host:5432/postgres \
 *   RESTORE_VERIFY_ISOLATION_CONFIRMATION=I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET \
 *   node scripts/backup/verify-restore.mjs --backup backups/agencyos-....dump
 *
 * Safety model (all enforced before the first write):
 *   - `RESTORE_VERIFY_ISOLATION_CONFIRMATION` must carry the exact confirmation
 *     string. An operator has to have looked at the target deliberately.
 *   - The target database name must carry the `agencyos_restore_verify_` prefix;
 *     it is suffixed with a random token so a name collision is impossible.
 *   - The target must not be the database named by `DATABASE_URL`.
 *   - `RESTORE_VERIFY_ALLOWED_PORT`, when set, pins the port (the runbook uses
 *     5433 for the isolated instance); a mismatch aborts.
 *   - CREATE DATABASE cannot run inside a transaction, so all validation
 *     happens on a separate read-only connection first, and the name is
 *     re-checked for existence immediately before creation.
 *
 * The script never runs `DROP DATABASE`, `pg_restore --clean`, `prisma db push`
 * or `prisma migrate dev`. Cleanup drops only the database this process created
 * (tracked in a variable, verified to carry the prefix).
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import {
  EXIT,
  RESTORE_DB_PREFIX,
  UsageError,
  assertDisposableTarget,
  fileSize,
  libpqEnv,
  parseConnectionUrl,
  redactUrl,
  runTool,
  sha256File,
} from './lib.mjs';

/** Tables the restore must contain. Kept in sync with backup.mjs. */
const CRITICAL_TABLES = [
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

/** Foreign-key constraints checked for validity after the restore. */
const INTEGRITY_QUERY = `
  SELECT json_build_object(
    'orphanConstraints', (
      SELECT COALESCE(json_agg(c.conname ORDER BY c.conname), '[]'::json)
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = 'public' AND NOT c.convalidated
    ),
    'unindexedForeignKeys', (
      SELECT COALESCE(json_agg(con.conname ORDER BY con.conname), '[]'::json)
      FROM pg_constraint con
      JOIN pg_namespace n ON n.oid = con.connamespace
      WHERE con.contype = 'f'
        AND n.nspname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = con.conrelid
            AND i.indisvalid
            AND i.indpred IS NULL
            AND (i.indkey::smallint[])[0:cardinality(con.conkey)-1] @> con.conkey
        )
    ),
    'invalidIndexes', (
      SELECT COALESCE(json_agg(ic.relname ORDER BY ic.relname), '[]'::json)
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = ic.relnamespace
      WHERE n.nspname = 'public' AND NOT i.indisvalid
    ),
    'tables', (
      SELECT COALESCE(json_agg(s.t ORDER BY s.t), '[]'::json)
      FROM (
        SELECT schemaname || '.' || relname AS t
        FROM pg_stat_user_tables WHERE schemaname = 'public'
      ) s
    ),
    'migrations', COALESCE((
      SELECT json_build_object(
        'applied', COUNT(*),
        'latest', MAX(migration_name)
      )
      FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ), json_build_object('applied', 0, 'latest', null)),
    'serverVersion', current_setting('server_version')
  )::text;
`;

function usage() {
  return `Usage: node scripts/backup/verify-restore.mjs --backup <archive.dump> [options]

Restores the archive into a NEW disposable database (prefix
"${RESTORE_DB_PREFIX}") and verifies schema, tables, row counts, migrations and
referential integrity. The isolation guards are mandatory; see the header of
this file.

Options:
  --backup <path>        Archive produced by scripts/backup/backup.mjs (required)
  --manifest <path>      Manifest path. Default: <backup>.json
  --target-database <n>  Explicit target name instead of a generated one. Must
                         still carry the "${RESTORE_DB_PREFIX}" prefix and must
                         not already exist. Useful with --keep for inspection.
  --keep                 Leave the disposable database in place for inspection
  --allow-empty-tables   Permit a restore whose critical tables are all empty
  --label <text>         Free-form label echoed into the evidence line
  --help                 Show this message

Environment:
  RESTORE_VERIFY_ADMIN_URL        Connection to the ISOLATED server (required)
  RESTORE_VERIFY_ISOLATION_CONFIRMATION
                                  Must equal I_CONFIRMED_A_DISPOSABLE_ISOLATED_TARGET
  RESTORE_VERIFY_ALLOWED_PORT     Optional port pin (runbook uses 5433)
  RESTORE_VERIFY_EXPECTED_SERVER_ADDRESS
                                  Optional expected host, checked after connecting
`;
}

function parseArgs(argv) {
  const options = { keep: false, allowEmptyTables: false };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case '--backup':
        options.backup = argv[++index];
        break;
      case '--manifest':
        options.manifest = argv[++index];
        break;
      case '--target-database':
        options.targetDatabase = argv[++index];
        break;
      case '--label':
        options.label = argv[++index];
        break;
      case '--keep':
        options.keep = true;
        break;
      case '--allow-empty-tables':
        options.allowEmptyTables = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new UsageError(`Unknown option: ${argv[index]}`);
    }
  }
  return options;
}

/** Run a read-only query and parse its single JSON row. */
async function queryJson(connection, sql) {
  const chunks = [];
  const result = await runTool(
    'psql',
    ['-X', '-q', '-At', '-w', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    {
      env: libpqEnv(connection),
      stdout: (stream) => stream.on('data', (chunk) => chunks.push(chunk)),
    }
  );
  if (result.code !== 0) {
    throw Object.assign(new Error(`SQL failed: ${result.stderrTail.trim()}`), {
      exitCode: EXIT.TOOL_FAILED,
    });
  }
  return JSON.parse(chunks.join('').trim());
}

/** Run a statement against the admin database, returning psql's output. */
async function exec(connection, sql) {
  const chunks = [];
  const result = await runTool(
    'psql',
    ['-X', '-q', '-At', '-w', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    {
      env: libpqEnv(connection),
      stdout: (stream) => stream.on('data', (chunk) => chunks.push(chunk)),
    }
  );
  return { ...result, output: chunks.join('').trim() };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return EXIT.OK;
  }
  if (!options.backup) throw new UsageError('--backup <archive> is required');

  const adminUrl = process.env.RESTORE_VERIFY_ADMIN_URL;
  if (!adminUrl) {
    throw new UsageError(
      'RESTORE_VERIFY_ADMIN_URL is not set. It must point at the ISOLATED PostgreSQL ' +
        'instance that will receive the restore, never at the application database.'
    );
  }

  const admin = parseConnectionUrl(adminUrl, 'RESTORE_VERIFY_ADMIN_URL');
  const application = process.env.DATABASE_URL
    ? parseConnectionUrl(process.env.DATABASE_URL, 'DATABASE_URL')
    : undefined;
  const allowedPort = process.env.RESTORE_VERIFY_ALLOWED_PORT;

  // ---------------------------------------------------------------------------
  // Guards that need only configuration. No connection yet.
  // ---------------------------------------------------------------------------
  // A generated name is the safe default: it cannot collide with a database a
  // human forgot about. `--target-database` exists so an operator can name one
  // deliberately (typically with --keep), and it goes through the same guards.
  const targetDatabase =
    options.targetDatabase ??
    `${RESTORE_DB_PREFIX}${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[-:T]/g, '')
      .toLowerCase()}_${randomBytes(4).toString('hex')}`;

  const target = { ...admin, database: targetDatabase };

  assertDisposableTarget({
    target,
    application,
    confirmation: process.env.RESTORE_VERIFY_ISOLATION_CONFIRMATION,
    allowedPort,
  });

  if (targetDatabase === admin.database) {
    throw new UsageError('Restore refused: target database must differ from the admin database.');
  }

  // ---------------------------------------------------------------------------
  // Validate the archive and its manifest.
  // ---------------------------------------------------------------------------
  const archiveBytes = await fileSize(options.backup);
  if (archiveBytes === null) {
    throw new UsageError(`Backup archive not found: ${options.backup}`);
  }

  const manifestPath = options.manifest ?? `${options.backup}.json`;
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new UsageError(
      `Manifest missing or unreadable (${manifestPath}): ${error.message}. ` +
        'A restore without a manifest cannot prove the archive is the expected one.'
    );
  }

  const actualSha = await sha256File(options.backup);
  if (manifest.sha256 && manifest.sha256 !== actualSha) {
    throw Object.assign(
      new Error(
        `Checksum mismatch: manifest says ${manifest.sha256}, archive is ${actualSha}. ` +
          'The archive was modified or truncated; refusing to restore it.'
      ),
      { exitCode: EXIT.INTEGRITY }
    );
  }

  const listResult = await runTool('pg_restore', ['--list', options.backup], {
    stdout: (stream) => stream.resume(),
  });
  if (listResult.code !== 0) {
    throw Object.assign(
      new Error(`Archive failed pg_restore --list: ${listResult.stderrTail.trim()}`),
      { exitCode: EXIT.INTEGRITY }
    );
  }

  console.log(`[verify] archive      ${path.basename(options.backup)} (${archiveBytes} bytes)`);
  console.log(`[verify] sha256       ${actualSha} (matches manifest)`);
  console.log(`[verify] target host  ${redactUrl(adminUrl)}`);
  console.log(`[verify] target db    ${targetDatabase}`);

  // ---------------------------------------------------------------------------
  // Confirm the server we reached is the one we validated.
  // ---------------------------------------------------------------------------
  const identity = await queryJson(
    admin,
    `SELECT json_build_object(
       'database', current_database(),
       'serverAddress', COALESCE(host(inet_server_addr()), 'local'),
       'port', current_setting('port'),
       'version', current_setting('server_version')
     )::text;`
  );

  const expectedAddress = process.env.RESTORE_VERIFY_EXPECTED_SERVER_ADDRESS;
  if (expectedAddress && identity.serverAddress !== expectedAddress) {
    throw new UsageError(
      `Connected server address "${identity.serverAddress}" does not match ` +
        `RESTORE_VERIFY_EXPECTED_SERVER_ADDRESS "${expectedAddress}". Aborting before any write.`
    );
  }
  console.log(
    `[verify] connected    ${identity.database} @ ${identity.serverAddress}:${identity.port} (PostgreSQL ${identity.version})`
  );

  // ---------------------------------------------------------------------------
  // Create the disposable database. Nothing has been written until this line.
  // ---------------------------------------------------------------------------
  const exists = await exec(
    admin,
    `SELECT 1 FROM pg_database WHERE datname = '${targetDatabase.replace(/'/g, "''")}';`
  );
  // A failed probe is not "the database does not exist": proceeding on an
  // empty result would mean creating a database we could not confirm was
  // absent. Fail closed.
  if (exists.code !== 0) {
    throw Object.assign(
      new Error(`Could not check whether ${targetDatabase} exists: ${exists.stderrTail.trim()}`),
      { exitCode: EXIT.TOOL_FAILED }
    );
  }
  if (exists.output.trim() === '1') {
    throw Object.assign(
      new Error(`Target database ${targetDatabase} already exists; refusing to reuse it.`),
      { exitCode: EXIT.UNSAFE }
    );
  }

  let created = false;
  let verification = { status: 'not-run' };
  const startedAt = Date.now();

  try {
    const create = await exec(admin, `CREATE DATABASE "${targetDatabase}";`);
    if (create.code !== 0) {
      throw Object.assign(new Error(`CREATE DATABASE failed: ${create.stderrTail.trim()}`), {
        exitCode: EXIT.TOOL_FAILED,
      });
    }
    created = true;
    console.log('[verify] created     disposable database');

    // -------------------------------------------------------------------------
    // Restore. `--single-transaction` makes a partial restore impossible: any
    // error rolls the whole thing back. `--no-owner` avoids role dependencies.
    // No `--clean` — the target is empty by construction.
    // -------------------------------------------------------------------------
    // `pg_restore` does NOT fall back to PGDATABASE: without an explicit
    // database it reads the archive and writes nothing, exiting 0. That is a
    // silent no-op that looks exactly like a successful restore, so `--dbname`
    // is mandatory here rather than implied by the environment. The name is a
    // separate argv entry and carries no credential.
    const restore = await runTool(
      'pg_restore',
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        '--verbose',
        '--dbname',
        target.database,
        options.backup,
      ],
      { env: libpqEnv(target) }
    );

    if (restore.code !== 0) {
      throw Object.assign(
        new Error(`pg_restore failed (exit ${restore.code}): ${restore.stderrTail.trim()}`),
        { exitCode: EXIT.TOOL_FAILED }
      );
    }
    console.log(`[verify] restored    archive applied in ${Date.now() - startedAt} ms`);

    // -------------------------------------------------------------------------
    // Verify the recovered data.
    // -------------------------------------------------------------------------
    const report = await queryJson(target, INTEGRITY_QUERY);

    // Fail closed on a malformed report. Without this, a psql that returns
    // something unexpected (a different client, a proxy, an error page) would
    // surface as "name.replace is not a function" rather than "verification
    // could not run", and a crash is easy to mistake for a tool bug.
    if (!Array.isArray(report.tables) || !report.tables.every((t) => typeof t === 'string')) {
      throw Object.assign(
        new Error(
          'Verification query returned an unexpected table list; refusing to report success: ' +
            JSON.stringify(report.tables).slice(0, 200)
        ),
        { exitCode: EXIT.VERIFY_FAILED }
      );
    }

    const present = new Set(report.tables.map((name) => name.replace(/^public\./, '')));
    const missingTables = CRITICAL_TABLES.filter((table) => !present.has(table));
    if (missingTables.length > 0) {
      throw Object.assign(
        new Error(`Restore is missing critical tables: ${missingTables.join(', ')}`),
        { exitCode: EXIT.VERIFY_FAILED }
      );
    }

    if ((report.orphanConstraints ?? []).length > 0) {
      throw Object.assign(
        new Error(
          `Restore left ${report.orphanConstraints.length} unvalidated foreign-key constraint(s): ` +
            report.orphanConstraints.join(', ')
        ),
        { exitCode: EXIT.VERIFY_FAILED }
      );
    }

    if ((report.invalidIndexes ?? []).length > 0) {
      throw Object.assign(
        new Error(`Restore left invalid indexes: ${report.invalidIndexes.join(', ')}`),
        { exitCode: EXIT.VERIFY_FAILED }
      );
    }

    const appliedMigrations = report.migrations?.applied ?? 0;
    if (appliedMigrations === 0) {
      throw Object.assign(
        new Error('Restore has no applied Prisma migrations; schema history did not survive.'),
        { exitCode: EXIT.VERIFY_FAILED }
      );
    }

    // Exact per-table counts. `count(*)` on every table walks the restored data,
    // which is the point: we want to know the rows are physically there, not
    // what the planner estimates. (pg_stat_user_tables would read 0 in a
    // freshly restored database because no ANALYZE has run yet.)
    const counts = await queryJson(
      target,
      `SELECT COALESCE(json_object_agg(t, c), '{}'::json)::text FROM (
         SELECT c.relname AS t,
                (xpath('/row/c/text()',
                  query_to_xml(
                    format('SELECT count(*) AS c FROM public.%I', c.relname),
                    false, true, '')))[1]::text::bigint AS c
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
       ) exact;`
    );

    const manifestTables = new Map(
      (manifest.metadata?.tables ?? []).map((entry) => [entry.table, Number(entry.rows)])
    );
    // Every table the manifest says held data must still hold at least as many
    // rows. A source that kept writing after the snapshot can legitimately show
    // *more*; fewer means rows were lost in transit, which is fatal.
    const shrunk = [];
    const differing = [];
    for (const [table, sourceRows] of manifestTables) {
      const restoredRows = Number(counts[table] ?? 0);
      if (restoredRows < Number(sourceRows)) {
        shrunk.push(`${table}: ${sourceRows} -> ${restoredRows}`);
      }
      if (restoredRows !== Number(sourceRows)) {
        differing.push(table);
      }
    }
    if (shrunk.length > 0) {
      throw Object.assign(
        new Error(`Restore lost rows in ${shrunk.length} table(s): ${shrunk.join('; ')}`),
        { exitCode: EXIT.VERIFY_FAILED }
      );
    }

    const totalRows = Object.values(counts).reduce((sum, value) => sum + Number(value ?? 0), 0);
    const populatedTables = Object.entries(counts).filter(([, rows]) => Number(rows) > 0);
    if (totalRows === 0 && !options.allowEmptyTables) {
      throw Object.assign(
        new Error(
          'Restore is empty (no rows in any table). Pass --allow-empty-tables only for a ' +
            'deliberately empty source database.'
        ),
        { exitCode: EXIT.VERIFY_FAILED }
      );
    }

    // A live source keeps writing after pg_dump takes its snapshot, so exact
    // equality is reported but only *shrinkage* is fatal. CI runs against a
    // quiescent database, where the two numbers do match.
    if (differing.length > 0) {
      console.log(
        `[verify] NOTE ${differing.length} table(s) hold more rows than the manifest recorded ` +
          `(${differing.join(', ')}); expected when the source was written to during the dump.`
      );
    }

    verification = {
      status: 'passed',
      schemaTables: present.size,
      criticalTables: CRITICAL_TABLES.length,
      populatedTables: populatedTables.length,
      totalRows,
      rowCountsMatchManifest: differing.length === 0,
      appliedMigrations,
      latestMigration: report.migrations?.latest ?? null,
      unvalidatedForeignKeys: 0,
      invalidIndexes: 0,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    // -------------------------------------------------------------------------
    // Cleanup. Only the database this process created is removed, and only
    // after re-checking the prefix. `--keep` leaves it for diagnosis.
    // -------------------------------------------------------------------------
    if (created && !options.keep) {
      if (!targetDatabase.startsWith(RESTORE_DB_PREFIX)) {
        console.error('[verify] refusing cleanup: target name lost its disposable prefix');
      } else {
        const drop = await exec(admin, `DROP DATABASE "${targetDatabase}";`);
        if (drop.code === 0) {
          console.log('[verify] cleaned     disposable database dropped');
        } else {
          console.error(
            `[verify] WARNING: could not drop ${targetDatabase}: ${drop.stderrTail.trim()}`
          );
        }
      }
    } else if (created && options.keep) {
      console.log(`[verify] kept        ${targetDatabase} (--keep)`);
    }
  }

  if (verification.status !== 'passed') {
    throw Object.assign(new Error('Restore verification did not complete'), {
      exitCode: EXIT.VERIFY_FAILED,
    });
  }

  console.log(
    `[verify] OK ${JSON.stringify({
      label: options.label ?? null,
      sha256: actualSha,
      ...verification,
    })}`
  );
  return EXIT.OK;
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
      console.error(`[verify] FAILED: ${error.message}`);
      process.exitCode = code;
    });
}

export { main, CRITICAL_TABLES };
