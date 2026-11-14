/**
 * Static guards for the finance uniqueness hardening (migration 0015).
 *
 * These assertions run without a database, so a regression in the audit script
 * (becoming non-read-only) or in the migration (dropping the partial predicate,
 * or creating an index before the duplicate guard) fails in the fast unit job.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

const auditScript = read('scripts/audit-uniqueness.mjs');
const migration = read('prisma/migrations/0015_add_invoice_and_payment_uniqueness/migration.sql');
const schema = read('prisma/schema.prisma');
const estimateRetirement = read('lib/sales/estimate-retirement.ts');
const estimateConvertRoute = read('app/api/v1/finance/estimates/[id]/convert/route.ts');

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

  it('initializes Prisma 7 with the pg driver adapter instead of a bare constructor', () => {
    expect(auditScript).toContain("require('@prisma/adapter-pg')");
    expect(auditScript).toContain('new PrismaPg(');
    expect(auditScript).toContain('new PrismaClient({ adapter })');
    expect(auditScript).not.toMatch(/new PrismaClient\(\s*\)/);
  });

  // The script imports @prisma/client at module load, so it needs a generated
  // client to even reach its own guard. CI generates it before running tests;
  // a checkout without one cannot exercise this assertion.
  const hasGeneratedClient = (() => {
    try {
      return existsSync(join(root, 'node_modules', '.prisma', 'client', 'default.js'));
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasGeneratedClient)(
    'fails clearly with exit code 2 when DATABASE_URL is unset instead of constructor error',
    () => {
      const result = spawnSync(process.execPath, ['scripts/audit-uniqueness.mjs'], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: '' },
        encoding: 'utf8',
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('DATABASE_URL environment variable is required');
      expect(result.stderr).not.toContain('PrismaClient needs to be constructed');
    }
  );
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

describe('estimate conversion retirement', () => {
  it('keeps no client-supplied invoice number anywhere in the conversion path', () => {
    // A client-supplied number used to be the defect this guard was written for;
    // the whole conversion path is now refused, so the only requirement left is
    // that no such input can be accepted again.
    expect(estimateConvertRoute).not.toMatch(/invoiceNumber/);
    expect(estimateConvertRoute).not.toContain('name="invoiceNumber"');
  });

  it('refuses conversion with the coded read-only contract instead of creating an invoice', () => {
    expect(estimateConvertRoute).toContain('estimateRetiredBody');
    expect(estimateConvertRoute).toContain('403');
    expect(estimateConvertRoute).not.toMatch(
      /convertEstimateToInvoice|allocateDocumentNumber|invoice\.create/
    );
    expect(estimateRetirement).toContain("'convert'");
    expect(estimateRetirement).toContain('estimate_read_only');
  });
});
