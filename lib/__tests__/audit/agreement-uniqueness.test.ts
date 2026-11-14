/**
 * Static guards for the single-active-agreement guarantee (migration 0023).
 *
 * Two simultaneous "Create Agreement" requests for one accepted quotation must
 * end up on the same agreement. The service serialises on the quotation row,
 * and this migration is the database-level backstop: a partial unique index
 * that admits at most one non-voided agreement per quotation while still
 * allowing a replacement after voiding.
 *
 * These assertions run without a database, so dropping the predicate, dropping
 * the index, or turning the migration into a data-repair step fails fast in the
 * unit job.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

const migration = read('prisma/migrations/0023_enforce_single_active_agreement/migration.sql');
const schema = read('prisma/schema.prisma');

describe('migration 0023: single active agreement per quotation', () => {
  it('creates a unique index on quotationId', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "Contract_quotationId_active_key"');
    expect(migration).toMatch(/ON "Contract" \("quotationId"\)/);
  });

  it('keeps the index partial so replacements after voiding stay possible', () => {
    expect(migration).toMatch(/WHERE "quotationId" IS NOT NULL AND "status" <> 'voided'/);
  });

  it('never repairs data: it reports duplicates and stops', () => {
    // The pre-flight guard must not void, delete or merge anything on its own.
    expect(migration).toContain('RAISE EXCEPTION');
    expect(migration).toContain('No data was changed');
    expect(migration).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+"Contract"/i);
  });

  it('points the schema comment at the SQL-only guarantee', () => {
    // Prisma cannot express partial indexes, so schema.prisma documents the
    // index that actually enforces the rule.
    expect(schema).toContain('Contract_quotationId_active_key');
  });
});
