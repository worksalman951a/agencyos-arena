/**
 * Integration: database-level uniqueness for invoices and payments.
 *
 * Covers migration `0015_add_invoice_and_payment_uniqueness` end to end against
 * a real PostgreSQL database:
 *
 *  - both indexes exist and the migration is recorded;
 *  - a duplicate invoice number is rejected by the database, per organization;
 *  - concurrent invoice creation never hands out the same number twice;
 *  - a replayed payment idempotency key records exactly one payment, even when
 *    two requests race;
 *  - keyless payments (NULL or blank keys) are never constrained;
 *  - the same key is still usable on a different invoice;
 *  - the migration's DDL is reversible (drop + recreate succeeds, and is rolled
 *    back so the suite leaves the database unchanged).
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

async function createUserWithOrg(label: string) {
  const email = `${label}-${Date.now()}@uniqueness-test.invalid`;

  const signUp = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD, name: `Uniqueness ${label}` }),
  });
  expect(signUp.status).toBe(200);

  const signIn = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(signIn.status).toBe(200);
  const token =
    (signIn.headers.get('set-cookie') ?? '').match(/better-auth\.session_token=([^;]+)/)?.[1] ?? '';
  expect(token).toBeTruthy();

  const bootstrap = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: {
      Cookie: `better-auth.session_token=${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: SERVER_URL,
    },
    body: JSON.stringify({ organizationName: `Uniqueness Org ${label}` }),
  });
  expect(bootstrap.status).toBe(200);

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeTruthy();
  const org = await prisma.organization.findFirstOrThrow({
    where: { userRoles: { some: { userId: user!.id } } },
    select: { id: true },
  });

  return { user: user!, token, organizationId: org.id };
}

describeIfDb('Finance uniqueness constraints (real PostgreSQL)', () => {
  let token = '';
  let organizationId = '';
  let userId = '';
  let contactId = '';
  let foreignOrgId = '';
  let foreignUserId = '';

  const auth = () => ({
    Cookie: `better-auth.session_token=${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  const createInvoice = async (title: string, unitPrice = '100.00') => {
    const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        title,
        clientId: contactId,
        currency: 'USD',
        lineItems: [{ description: 'Work', quantity: '1', unitPrice, taxRate: '0' }],
      }),
    });
    const text = await res.text();
    expect(res.status, `invoice create failed: ${text}`).toBe(201);
    return JSON.parse(text) as { id: string; number: string };
  };

  const pay = async (invoiceId: string, body: Record<string, unknown>) => {
    const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
  };

  beforeAll(async () => {
    await prisma.$connect();
    const account = await createUserWithOrg('primary');
    token = account.token;
    userId = account.user.id;
    organizationId = account.organizationId;

    const contact = await prisma.contact.create({
      data: {
        organizationId,
        firstName: 'Unique',
        lastName: 'Client',
        email: `unique-client-${Date.now()}@example.com`,
        status: 'active',
        createdBy: userId,
        updatedBy: userId,
      },
    });
    contactId = contact.id;

    const foreign = await createUserWithOrg('foreign');
    foreignUserId = foreign.user.id;
    foreignOrgId = foreign.organizationId;
  });

  afterAll(async () => {
    for (const orgId of [organizationId, foreignOrgId].filter(Boolean)) {
      await prisma.payment
        .deleteMany({ where: { invoice: { organizationId: orgId } } })
        .catch(() => {});
      await prisma.invoice.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.role.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    }
    for (const id of [userId, foreignUserId].filter(Boolean)) {
      await prisma.session.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('records the migration and creates both indexes', async () => {
    const migrations = (await prisma.$queryRawUnsafe(
      `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name LIKE '%uniqueness%'`
    )) as Array<{ migration_name: string }>;
    expect(migrations.map((row: { migration_name: string }) => row.migration_name)).toContain(
      '0015_add_invoice_and_payment_uniqueness'
    );

    const indexes = (await prisma.$queryRawUnsafe(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN ('Invoice_organizationId_number_key', 'Payment_invoiceId_idempotencyKey_key')`
    )) as Array<{ indexname: string; indexdef: string }>;
    const byName = new Map(
      indexes.map((row: { indexname: string; indexdef: string }) => [row.indexname, row.indexdef])
    );
    expect(byName.get('Invoice_organizationId_number_key')).toMatch(/UNIQUE INDEX/);
    expect(byName.get('Payment_invoiceId_idempotencyKey_key')).toMatch(/UNIQUE INDEX/);
    // The payment index must stay partial, so keyless payments are unconstrained.
    expect(byName.get('Payment_invoiceId_idempotencyKey_key')).toMatch(/WHERE/);
  });

  it('rejects a duplicate invoice number inside one organization', async () => {
    const number = `DUP-${Date.now()}`;
    await prisma.invoice.create({
      data: { organizationId, number, title: 'First', status: 'draft', total: '10.00' },
    });

    await expect(
      prisma.invoice.create({
        data: { organizationId, number, title: 'Second', status: 'draft', total: '10.00' },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the same invoice number in a different organization', async () => {
    const number = `SHARED-${Date.now()}`;
    const first = await prisma.invoice.create({
      data: { organizationId, number, title: 'Mine', status: 'draft', total: '10.00' },
    });
    const second = await prisma.invoice.create({
      data: {
        organizationId: foreignOrgId,
        number,
        title: 'Theirs',
        status: 'draft',
        total: '10.00',
      },
    });
    expect(first.id).not.toBe(second.id);
  });

  it('never hands out the same number to concurrent creations', async () => {
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, index) => createInvoice(`Concurrent ${index}`))
    );
    const numbers = created.map((invoice) => invoice.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('records one payment when two requests replay the same idempotency key', async () => {
    const invoice = await createInvoice('Racing key', '100.00');
    const payload = {
      amount: '30.00',
      method: 'bank_transfer',
      idempotencyKey: `race-${Date.now()}`,
    };

    const [first, second] = await Promise.all([pay(invoice.id, payload), pay(invoice.id, payload)]);

    expect([first.status, second.status]).toEqual([201, 201]);
    const stored = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(stored).toHaveLength(1);
    const duplicates = [first, second].filter((result) => result.body.duplicate === true);
    expect(duplicates).toHaveLength(1);
  });

  it('leaves keyless payments unconstrained', async () => {
    const invoice = await createInvoice('Keyless', '100.00');

    const first = await pay(invoice.id, { amount: '10.00', method: 'cash' });
    const second = await pay(invoice.id, { amount: '10.00', method: 'cash' });
    expect([first.status, second.status]).toEqual([201, 201]);

    const stored = (await prisma.payment.findMany({ where: { invoiceId: invoice.id } })) as Array<{
      idempotencyKey: string | null;
    }>;
    expect(stored).toHaveLength(2);
    expect(
      stored.every((payment: { idempotencyKey: string | null }) => payment.idempotencyKey === null)
    ).toBe(true);
  });

  it('treats a blank idempotency key as keyless and stores NULL', async () => {
    const invoice = await createInvoice('Blank key', '100.00');

    const first = await pay(invoice.id, { amount: '5.00', method: 'cash', idempotencyKey: '' });
    const second = await pay(invoice.id, { amount: '5.00', method: 'cash', idempotencyKey: '   ' });
    expect([first.status, second.status]).toEqual([201, 201]);

    const stored = (await prisma.payment.findMany({ where: { invoiceId: invoice.id } })) as Array<{
      idempotencyKey: string | null;
    }>;
    expect(stored).toHaveLength(2);
    expect(
      stored.every((payment: { idempotencyKey: string | null }) => payment.idempotencyKey === null)
    ).toBe(true);
  });

  it('still allows the same key on a different invoice', async () => {
    const key = `cross-invoice-${Date.now()}`;
    const firstInvoice = await createInvoice('Key A', '50.00');
    const secondInvoice = await createInvoice('Key B', '50.00');

    const first = await pay(firstInvoice.id, {
      amount: '10.00',
      method: 'cash',
      idempotencyKey: key,
    });
    const second = await pay(secondInvoice.id, {
      amount: '10.00',
      method: 'cash',
      idempotencyKey: key,
    });

    expect([first.status, second.status]).toEqual([201, 201]);
  });

  it('can drop and recreate both indexes (rollback-compatible DDL)', async () => {
    // Run the migration's inverse and re-apply inside a transaction that is
    // always rolled back, so the suite proves reversibility without changing
    // the test database.
    await expect(
      prisma.$transaction(async (tx: typeof prisma) => {
        await tx.$executeRawUnsafe('DROP INDEX IF EXISTS "Invoice_organizationId_number_key"');
        await tx.$executeRawUnsafe('DROP INDEX IF EXISTS "Payment_invoiceId_idempotencyKey_key"');

        await tx.$executeRawUnsafe(
          'CREATE UNIQUE INDEX "Invoice_organizationId_number_key" ON "Invoice" ("organizationId", "number")'
        );
        await tx.$executeRawUnsafe(
          `CREATE UNIQUE INDEX "Payment_invoiceId_idempotencyKey_key" ON "Payment" ("invoiceId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL AND btrim("idempotencyKey") <> ''`
        );

        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');

    const indexes = (await prisma.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN ('Invoice_organizationId_number_key', 'Payment_invoiceId_idempotencyKey_key')`
    )) as Array<{ indexname: string }>;
    expect(indexes).toHaveLength(2);
  });
});
