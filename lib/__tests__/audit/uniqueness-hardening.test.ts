/**
 * Static guards for the finance uniqueness hardening (migration 0015).
 *
 * These assertions run without a database, so a regression in the audit script
 * (becoming non-read-only) or in the migration (dropping the partial predicate,
 * or creating an index before the duplicate guard) fails in the fast unit job.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

const auditScript = read('scripts/audit-uniqueness.mjs');
const migration = read('prisma/migrations/0015_add_invoice_and_payment_uniqueness/migration.sql');
const schema = read('prisma/schema.prisma');
const convertSchema = read('lib/schemas/crm/estimate.schema.ts');
const convertPage = read('app/finance/estimates/[id]/convert/page.tsx');

describe('uniqueness audit script', () => {
  it('is strictly read-only', () => {
    expect(auditScript).not.toMatch(/\$executeRaw/);
    expect(auditScript).not.toMatch(
      /\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+"|DROP\s+(TABLE|INDEX|CONSTRAINT)|ALTER\s+TABLE|TRUNCATE)\b/i
    );
  });

  it('audits both uniqueness targets and the blank-key case', () => {
    expect(auditScript).toContain('FROM "Invoice"');
    expect(auditScript).toContain('"idempotencyKey" IS NOT NULL');
    expect(auditScript).toContain('btrim("idempotencyKey")');
    expect(auditScript).toContain('pg_indexes');
  });
});

describe('migration 0015', () => {
  it('creates both unique indexes', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_organizationId_number_key"'
    );
    expect(migration).toContain('"Payment_invoiceId_idempotencyKey_key"');
  });

  it('keeps the payment index partial so keyless payments stay valid', () => {
    expect(migration).toMatch(
      /WHERE "idempotencyKey" IS NOT NULL AND btrim\("idempotencyKey"\) <> ''/
    );
  });

  it('refuses to proceed when duplicates exist, without repairing them', () => {
    const guardIndex = migration.indexOf('RAISE EXCEPTION');
    const firstIndex = migration.indexOf('CREATE UNIQUE INDEX');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(firstIndex);
    // No data changes anywhere in the migration.
    expect(migration).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+"[A-Za-z]+"\s+SET)\b/i);
  });

  it('documents its rollback', () => {
    expect(migration).toContain('DROP INDEX IF EXISTS "Invoice_organizationId_number_key"');
    expect(migration).toContain('DROP INDEX IF EXISTS "Payment_invoiceId_idempotencyKey_key"');
  });
});

describe('schema parity', () => {
  it('declares the invoice number unique per organization', () => {
    const invoiceModel = schema.slice(
      schema.indexOf('model Invoice {'),
      schema.indexOf('model InvoiceItem {')
    );
    expect(invoiceModel).toContain('@@unique([organizationId, number])');
  });
});

describe('estimate conversion form', () => {
  it('no longer accepts a client-supplied invoice number', () => {
    expect(convertSchema).not.toMatch(/invoiceNumber\s*:/);
    expect(convertPage).not.toContain('name="invoiceNumber"');
  });

  it('shows the number the server allocated', () => {
    expect(convertPage).toContain('converted.invoiceNumber');
  });
});
