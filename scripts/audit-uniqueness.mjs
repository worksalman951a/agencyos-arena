#!/usr/bin/env node
/**
 * Read-only uniqueness audit for the finance tables.
 *
 * Run **before** applying migration `0015_add_invoice_and_payment_uniqueness`:
 *
 *   DATABASE_URL="postgresql://…" node scripts/audit-uniqueness.mjs
 *
 * The script only ever issues `SELECT`/`SHOW` queries. It never writes, renames,
 * renumbers, deletes or "repairs" a record: if duplicates exist it reports the
 * affected ids and exits with status 1, and remediation stays a manual decision.
 *
 * Checks:
 *  1. `Invoice(organizationId, number)` duplicates  → blocks the unique index.
 *  2. `Payment(invoiceId, idempotencyKey)` duplicates, ignoring NULL/blank keys
 *     → blocks the partial unique index.
 *  3. Blank ('' or whitespace) idempotency keys → informational: the partial
 *     index deliberately excludes them, and new writes normalise them to NULL.
 *  4. Existing indexes / constraints on both tables, so nothing is added blind.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROW_LIMIT = 50;

function section(title) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

function reportDuplicates(label, rows, describe) {
  if (rows.length === 0) {
    console.log(`OK   ${label}: no duplicates.`);
    return true;
  }
  console.log(`FAIL ${label}: ${rows.length} duplicate group(s) found.`);
  for (const row of rows.slice(0, ROW_LIMIT)) {
    console.log(`     ${describe(row)}`);
  }
  if (rows.length > ROW_LIMIT) {
    console.log(`     … ${rows.length - ROW_LIMIT} more group(s) not shown.`);
  }
  return false;
}

async function main() {
  let blocking = false;

  section('1. Invoice(organizationId, number) duplicates');
  const invoiceDuplicates = await prisma.$queryRawUnsafe(
    `SELECT "organizationId",
            number,
            count(*)::int                    AS occurrences,
            array_agg(id ORDER BY id)        AS invoice_ids,
            count(*) FILTER (WHERE "deletedAt" IS NULL)::int AS live_count
       FROM "Invoice"
      GROUP BY "organizationId", number
     HAVING count(*) > 1
      ORDER BY occurrences DESC, number`
  );
  blocking = !reportDuplicates(
    'Invoice numbers per organization',
    invoiceDuplicates,
    (row) =>
      `organization ${row.organizationId} · number "${row.number}" · ${row.occurrences} rows (${row.live_count} not deleted) · ids: ${row.invoice_ids.join(', ')}`
  ) || blocking;

  section('2. Payment(invoiceId, idempotencyKey) duplicates');
  const paymentDuplicates = await prisma.$queryRawUnsafe(
    `SELECT "invoiceId",
            "idempotencyKey",
            count(*)::int             AS occurrences,
            array_agg(id ORDER BY id) AS payment_ids
       FROM "Payment"
      WHERE "idempotencyKey" IS NOT NULL
        AND btrim("idempotencyKey") <> ''
      GROUP BY "invoiceId", "idempotencyKey"
     HAVING count(*) > 1
      ORDER BY occurrences DESC`
  );
  blocking = !reportDuplicates(
    'Payment idempotency keys per invoice',
    paymentDuplicates,
    (row) =>
      `invoice ${row.invoiceId} · key "${row.idempotencyKey}" · ${row.occurrences} rows · ids: ${row.payment_ids.join(', ')}`
  ) || blocking;

  section('3. Blank idempotency keys (informational, not blocked)');
  const blankKeys = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int                AS blank_keys,
            count(DISTINCT "invoiceId")::int AS invoices
       FROM "Payment"
      WHERE "idempotencyKey" IS NOT NULL
        AND btrim("idempotencyKey") = ''`
  );
  const blank = blankKeys[0] ?? { blank_keys: 0, invoices: 0 };
  console.log(
    `INFO ${blank.blank_keys} payment(s) across ${blank.invoices} invoice(s) store an empty key.`
  );
  console.log(
    '     These are treated as keyless: the partial unique index skips them and new writes store NULL.'
  );

  section('4. Existing indexes and constraints');
  const indexes = await prisma.$queryRawUnsafe(
    `SELECT tablename, indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename IN ('Invoice', 'Payment')
      ORDER BY tablename, indexname`
  );
  for (const row of indexes) {
    console.log(`     ${row.tablename}.${row.indexname}: ${row.indexdef}`);
  }

  section('5. Target indexes');
  const targets = [
    { name: 'Invoice_organizationId_number_key', table: 'Invoice' },
    { name: 'Payment_invoiceId_idempotencyKey_key', table: 'Payment' },
  ];
  for (const target of targets) {
    const present = indexes.some((row) => row.indexname === target.name);
    console.log(
      `     ${present ? 'PRESENT' : 'MISSING'} ${target.name} (${target.table})`
    );
  }

  section('Verdict');
  if (blocking) {
    console.log(
      'Duplicates exist. The unique indexes cannot be created safely and this audit');
    console.log(
      'changed nothing. Decide manually which record is correct for each group, then');
    console.log(
      're-run this audit. Remediation guidance: docs/phase-3a/uniqueness-hardening.md');
    process.exitCode = 1;
    return;
  }
  console.log('No blocking duplicates. Migration 0015 is safe to apply on this database.');
}

main()
  .catch((error) => {
    console.error('Audit failed (no data was modified):', error);
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
