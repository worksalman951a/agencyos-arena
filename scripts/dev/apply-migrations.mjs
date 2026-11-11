#!/usr/bin/env node
/**
 * Apply checked-in Prisma migrations to a local PostgreSQL database.
 *
 * CI (`.github/workflows/ci.yml`) uses `prisma migrate deploy`, which is the
 * canonical path. This script exists for sandboxed environments where the
 * Prisma CLI cannot download its native schema engine binary (no network
 * access to binaries.prisma.sh), so `migrate deploy` fails before it ever
 * reaches the database.
 *
 * It applies the exact checked-in SQL, in lexical order, inside a transaction
 * per migration, and records each one in `_prisma_migrations` with the same
 * shape Prisma uses — so a later real `prisma migrate deploy` sees them as
 * already applied instead of re-running them.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/dev/apply-migrations.mjs
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma', 'migrations');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" varchar(36) PRIMARY KEY NOT NULL,
      "checksum" varchar(64) NOT NULL,
      "finished_at" timestamptz,
      "migration_name" varchar(255) NOT NULL,
      "logs" text,
      "rolled_back_at" timestamptz,
      "started_at" timestamptz NOT NULL DEFAULT now(),
      "applied_steps_count" integer NOT NULL DEFAULT 0
    )
  `);

  const { rows: applied } = await client.query(
    'SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL'
  );
  const appliedNames = new Set(applied.map((row) => row.migration_name));

  const entries = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let count = 0;
  for (const name of entries) {
    if (appliedNames.has(name)) continue;

    const sql = await readFile(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const id = randomUuid();

    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count") VALUES ($1, $2, $3, now(), 0)',
        [id, checksum, name]
      );
      await client.query(sql);
      await client.query(
        'UPDATE "_prisma_migrations" SET "finished_at" = now(), "applied_steps_count" = 1 WHERE "id" = $1',
        [id]
      );
      await client.query('COMMIT');
      count += 1;
      console.log(`applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`failed ${name}: ${error.message}`);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`${count} migration(s) applied, ${entries.length} total`);
} finally {
  await client.end();
}

function randomUuid() {
  // Node's crypto.randomUUID is available in every supported runtime.
  return globalThis.crypto.randomUUID();
}
