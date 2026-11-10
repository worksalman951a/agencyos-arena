/**
 * Integration: invoice payments (real PostgreSQL).
 *
 * Pins the financial-integrity rules of `recordPayment` against a real
 * database and real HTTP endpoints:
 *
 *  - partial payments accumulate (the invoice becomes `paid` only when the
 *    recorded payments cover the total, and never before);
 *  - overpayment is rejected and writes nothing;
 *  - a replayed `idempotencyKey` returns the original payment instead of
 *    recording a second one;
 *  - voided and soft-deleted invoices reject payments;
 *  - cross-organization invoices answer 404 without leaking their existence.
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
  const email = `${label}-${Date.now()}@payments-test.invalid`;

  const signUp = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD, name: `Payments ${label}` }),
  });
  expect(signUp.status).toBe(200);

  const signIn = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(signIn.status).toBe(200);
  const token = (signIn.headers.get('set-cookie') ?? '').match(
    /better-auth\.session_token=([^;]+)/
  )?.[1];
  expect(token).toBeTruthy();

  const bootstrap = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: {
      Cookie: `better-auth.session_token=${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: SERVER_URL,
    },
    body: JSON.stringify({ organizationName: `Payments Org ${label}` }),
  });
  expect(bootstrap.status).toBe(200);

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeTruthy();

  return { user: user!, token: token!, email };
}

describeIfDb('Invoice payments (real PostgreSQL)', () => {
  let token = '';
  let organizationId = '';
  let userId = '';
  let contactId = '';

  const auth = () => ({
    Cookie: `better-auth.session_token=${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  const createInvoice = async (title: string, unitPrice: string) => {
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
    expect(res.status, `invoice create failed: ${await res.text()}`).toBe(201);
    return (await res.json()) as { id: string; number: string };
  };

  const pay = async (invoiceId: string, body: Record<string, unknown>) => {
    const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  const getInvoice = async (invoiceId: string) => {
    const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${invoiceId}`, { headers: auth() });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      status: string;
      total: string;
      payments: Array<{ id: string; amount: string }>;
    };
  };

  beforeAll(async () => {
    await prisma.$connect();
    const created = await createUserWithOrg('payments');
    token = created.token;
    userId = created.user.id;

    const org = await prisma.organization.findFirst({
      where: { userRoles: { some: { userId } } },
    });
    expect(org).toBeTruthy();
    organizationId = org!.id;

    const contact = await prisma.contact.create({
      data: {
        organizationId,
        firstName: 'Payment',
        lastName: 'Client',
        email: `payment-client-${Date.now()}@example.com`,
        status: 'active',
        createdBy: userId,
        updatedBy: userId,
      },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.payment.deleteMany({ where: { invoice: { organizationId } } }).catch(() => {});
      await prisma.invoice.deleteMany({ where: { organizationId } }).catch(() => {});
      await prisma.estimate.deleteMany({ where: { organizationId } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { organizationId } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { organizationId } }).catch(() => {});
      await prisma.role.deleteMany({ where: { organizationId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    }
    if (userId) {
      await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('accumulates partial payments and only marks the invoice paid when covered', async () => {
    const invoice = await createInvoice('Partial payments', '100.00');

    const first = await pay(invoice.id, {
      amount: '30.00',
      method: 'bank_transfer',
      reference: 'PART-1',
    });
    expect(first.status).toBe(201);
    expect(first.body.invoiceStatus).toBe('sent');
    expect(first.body.amountPaid).toBe('30.00');
    expect(first.body.balance).toBe('70.00');

    const afterFirst = await getInvoice(invoice.id);
    expect(afterFirst.status).toBe('sent');
    expect(afterFirst.payments).toHaveLength(1);
    expect(afterFirst.payments[0].amount).toBe('30.00');

    const second = await pay(invoice.id, { amount: '70.00', method: 'card' });
    expect(second.status).toBe(201);
    expect(second.body.invoiceStatus).toBe('paid');
    expect(second.body.amountPaid).toBe('100.00');
    expect(second.body.balance).toBe('0.00');

    const afterSecond = await getInvoice(invoice.id);
    expect(afterSecond.status).toBe('paid');
    expect(afterSecond.payments).toHaveLength(2);
  });

  it('rejects an overpayment and records nothing', async () => {
    const invoice = await createInvoice('Overpayment', '100.00');

    const partial = await pay(invoice.id, { amount: '60.00', method: 'cash' });
    expect(partial.status).toBe(201);

    const over = await pay(invoice.id, { amount: '60.00', method: 'cash' });
    expect(over.status).toBe(400);
    expect(String(over.body.error)).toMatch(/outstanding balance/i);

    const invoiceAfter = await getInvoice(invoice.id);
    expect(invoiceAfter.payments).toHaveLength(1);
    expect(invoiceAfter.status).toBe('sent');
  });

  it('returns the original payment when the same idempotency key is replayed', async () => {
    const invoice = await createInvoice('Idempotent', '50.00');
    const payload = {
      amount: '20.00',
      method: 'bank_transfer',
      idempotencyKey: `idem-${Date.now()}`,
    };

    const first = await pay(invoice.id, payload);
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);

    const replay = await pay(invoice.id, payload);
    expect(replay.status).toBe(201);
    expect(replay.body.duplicate).toBe(true);
    expect((replay.body.payment as { id: string }).id).toBe(
      (first.body.payment as { id: string }).id
    );

    const invoiceAfter = await getInvoice(invoice.id);
    expect(invoiceAfter.payments).toHaveLength(1);
  });

  it('rejects payments on a voided invoice', async () => {
    const invoice = await createInvoice('Voided', '10.00');

    const voided = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${invoice.id}`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ status: 'voided' }),
    });
    expect(voided.status).toBe(200);

    const result = await pay(invoice.id, { amount: '5.00', method: 'cash' });
    expect(result.status).toBe(400);
    expect(String(result.body.error)).toMatch(/voided invoice/i);
  });

  it('treats a soft-deleted invoice as missing', async () => {
    const invoice = await createInvoice('Deleted', '10.00');

    const deleted = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${invoice.id}`, {
      method: 'DELETE',
      headers: auth(),
    });
    expect(deleted.status).toBe(200);

    const result = await pay(invoice.id, { amount: '5.00', method: 'cash' });
    expect(result.status).toBe(404);
  });

  it('answers 404 for an invoice in another organization', async () => {
    const foreignInvoice = await prisma.invoice.create({
      data: {
        organizationId: (
          await prisma.organization.findFirstOrThrow({
            where: { id: { not: organizationId } },
            select: { id: true },
          })
        ).id,
        number: `FOREIGN-${Date.now()}`,
        title: 'Foreign invoice',
        status: 'sent',
        total: '99.00',
      },
    });

    const result = await pay(foreignInvoice.id, { amount: '1.00', method: 'cash' });
    expect(result.status).toBe(404);

    await prisma.invoice.delete({ where: { id: foreignInvoice.id } }).catch(() => {});
  });
});
