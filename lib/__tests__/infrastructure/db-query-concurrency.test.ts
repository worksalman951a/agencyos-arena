/**
 * PostgreSQL query-concurrency regression tests.
 *
 * `DeprecationWarning: Calling client.query() when the client is already
 * executing a query` came from pg itself (>= 8.22):
 *
 *   - `prisma.$transaction([...])` pins the statements to ONE pg connection.
 *   - Prisma 7 dispatches a query's relation loads (`include`) concurrently.
 *   - Those concurrent calls queue on that single client, which pg deprecates
 *     and removes in pg 9.
 *
 * `listInvoices` was the first place it surfaced (the Invoices list page does
 * `$transaction([findMany with 3 includes, count])`), which is why the warning
 * appeared in the InvoicesListPage stack.
 *
 * The fix is to run independent read-only statements with `Promise.all`, where
 * each statement takes its own pooled connection. Write transactions keep
 * `$transaction` because they need atomicity.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** Services whose list/summary reads were moved out of array transactions. */
const READ_ONLY_LISTS = [
  'lib/services/crm/account-service.ts',
  'lib/services/crm/contact-service.ts',
  'lib/services/crm/invoice-service.ts',
  'lib/services/crm/lead-service.ts',
  'lib/services/crm/opportunity-service.ts',
  'lib/services/crm/pipeline-service.ts',
  'lib/services/crm/pipeline-stage-service.ts',
  'lib/services/crm/project-service.ts',
  'lib/services/crm/proposal-service.ts',
  'lib/services/crm/quotation-service.ts',
];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('read-only statements are not pinned to a single connection', () => {
  it.each(READ_ONLY_LISTS)('%s has no array-form $transaction', (file) => {
    expect(read(file)).not.toContain('prisma.$transaction([');
  });

  it.each(READ_ONLY_LISTS)('%s still runs its reads concurrently', (file) => {
    expect(read(file)).toContain('Promise.all([');
  });

  it('listInvoices no longer wraps its page + count in a transaction', () => {
    const src = read('lib/services/crm/invoice-service.ts');
    const listInvoices = src.slice(src.indexOf('export async function listInvoices'));
    const body = listInvoices.slice(0, listInvoices.indexOf('\nexport async function'));

    expect(body).toContain('await Promise.all([');
    expect(body).not.toContain('await prisma.$transaction');
  });
});

describe('write transactions are preserved', () => {
  it('multi-step writes still use an interactive transaction', () => {
    // Proposal/quotations creation writes a header plus line items atomically.
    expect(read('lib/services/crm/proposal-service.ts')).toContain('prisma.$transaction(');
    expect(read('lib/services/crm/quotation-service.ts')).toContain('prisma.$transaction(');
    expect(read('app/api/auth/bootstrap-organization/route.ts')).toContain('prisma.$transaction(');
  });

  it('the pipeline-stage reorder still runs in one transaction', () => {
    const src = read('lib/services/crm/pipeline-stage-service.ts');
    expect(src).toContain('Use a transaction to update all stage orders atomically');
    expect(src).toContain('await prisma.$transaction(');
  });
});

describe('connection pool configuration', () => {
  it('sets explicit pool limits and timeouts', () => {
    const src = read('lib/db.ts');
    expect(src).toContain('new PrismaPg({');
    expect(src).toContain('max:');
    expect(src).toContain('connectionTimeoutMillis');
    expect(src).toContain('idleTimeoutMillis');
  });

  it('does not silence the pg deprecation warning', () => {
    const src = read('lib/db.ts');
    // No NODE_OPTIONS hacks, no process.removeAllListeners('warning'), no
    // suppression of DeprecationWarning anywhere in the database layer.
    expect(src).not.toContain('no-deprecation');
    expect(src).not.toContain('process.removeAllListeners');
    expect(src).not.toContain("process.on('warning'");
  });
});
