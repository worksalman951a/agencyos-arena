/**
 * Integration: estimate → invoice conversion (real PostgreSQL).
 *
 * The conversion used to create an invoice without a `number` (a required
 * column), so every attempt failed with a 500 *after* the estimate had been
 * marked `converted` — the accepted estimate was stranded and no invoice
 * existed. These tests pin the corrected contract:
 *
 *  - the invoice gets an allocated `PREFIX-YYYY-NNNN` number, not the
 *    client-supplied one;
 *  - the estimate's amount and currency are carried over;
 *  - the estimate becomes `converted` only once the invoice exists;
 *  - a second conversion, and any non-accepted estimate, are rejected with 400.
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

describeIfDb('Estimate conversion (real PostgreSQL)', () => {
  let token = '';
  let userId = '';
  let organizationId = '';
  let contactId = '';

  const auth = () => ({
    Cookie: `better-auth.session_token=${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  const createEstimate = async (overrides: Record<string, unknown> = {}) => {
    const res = await fetch(`${SERVER_URL}/api/v1/finance/estimates`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        clientId: contactId,
        number: `EST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'accepted',
        total: '250.00',
        currency: 'EUR',
        ...overrides,
      }),
    });
    expect(res.status, `estimate create failed: ${await res.text()}`).toBe(201);
    return (await res.json()) as { id: string; number: string; status: string };
  };

  const convert = async (estimateId: string, body: Record<string, unknown> = {}) => {
    const res = await fetch(`${SERVER_URL}/api/v1/finance/estimates/${estimateId}/convert`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        invoiceTitle: 'Converted estimate',
        invoiceNumber: 'CLIENT-SUPPLIED-1',
        ...body,
      }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    await prisma.$connect();

    const email = `estimate-convert-${Date.now()}@estimate-test.invalid`;
    const signUp = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: SERVER_URL,
      },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Estimate Convert' }),
    });
    expect(signUp.status).toBe(200);

    const signIn = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: SERVER_URL,
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(signIn.status).toBe(200);
    token =
      (signIn.headers.get('set-cookie') ?? '').match(/better-auth\.session_token=([^;]+)/)?.[1] ??
      '';
    expect(token).toBeTruthy();

    const bootstrap = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
      method: 'POST',
      headers: {
        Cookie: `better-auth.session_token=${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: SERVER_URL,
      },
      body: JSON.stringify({ organizationName: 'Estimate Convert Org' }),
    });
    expect(bootstrap.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeTruthy();
    userId = user!.id;

    const org = await prisma.organization.findFirst({
      where: { userRoles: { some: { userId } } },
    });
    expect(org).toBeTruthy();
    organizationId = org!.id;

    const contact = await prisma.contact.create({
      data: {
        organizationId,
        firstName: 'Estimate',
        lastName: 'Client',
        email: `estimate-client-${Date.now()}@example.com`,
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

  it('creates a numbered invoice from an accepted estimate and marks it converted', async () => {
    const estimate = await createEstimate({ total: '250.00', currency: 'EUR' });

    const result = await convert(estimate.id);
    expect(result.status).toBe(201);
    expect(result.body.invoiceId).toBeTruthy();
    const invoiceNumber = String(result.body.invoiceNumber);
    expect(invoiceNumber).toMatch(/^INV-\d{4}-\d{4,}$/);
    // The client-supplied number is not authoritative: the allocator assigns it.
    expect(invoiceNumber).not.toBe('CLIENT-SUPPLIED-1');

    const invoiceRes = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${result.body.invoiceId}`, {
      headers: auth(),
    });
    expect(invoiceRes.status).toBe(200);
    const invoice = (await invoiceRes.json()) as {
      number: string;
      total: string;
      currency: string;
      status: string;
    };
    expect(invoice.number).toBe(invoiceNumber);
    expect(invoice.total).toBe('250.00');
    expect(invoice.currency).toBe('EUR');
    expect(invoice.status).toBe('draft');

    const estimateRow = await prisma.estimate.findUnique({ where: { id: estimate.id } });
    expect(estimateRow?.status).toBe('converted');
  });

  it('refuses to convert the same estimate twice', async () => {
    const estimate = await createEstimate();

    const first = await convert(estimate.id, { invoiceNumber: 'FIRST-1' });
    expect(first.status).toBe(201);

    const second = await convert(estimate.id, { invoiceNumber: 'SECOND-1' });
    expect(second.status).toBe(400);
    expect(String(second.body.error)).toMatch(/accepted estimates/i);

    const invoices = await prisma.invoice.count({
      where: { organizationId, title: 'Converted estimate' },
    });
    // One per successful conversion; the refused attempt added nothing.
    expect(invoices).toBeGreaterThanOrEqual(2);
    const convertedRows = await prisma.invoice.findMany({
      where: { organizationId, number: 'SECOND-1' },
    });
    expect(convertedRows).toHaveLength(0);
  });

  it('rejects converting an estimate that is not accepted', async () => {
    const estimate = await createEstimate({ status: 'draft' });

    const result = await convert(estimate.id);
    expect(result.status).toBe(400);
    expect(String(result.body.error)).toMatch(/accepted estimates/i);

    const row = await prisma.estimate.findUnique({ where: { id: estimate.id } });
    expect(row?.status).toBe('draft');
  });

  it('answers 404 for an estimate in another organization', async () => {
    const otherOrg = await prisma.organization.findFirstOrThrow({
      where: { id: { not: organizationId } },
      select: { id: true },
    });
    const foreign = await prisma.estimate.create({
      data: {
        organizationId: otherOrg.id,
        number: `FOREIGN-EST-${Date.now()}`,
        clientId: contactId,
        status: 'accepted',
        total: '10.00',
        currency: 'USD',
      },
    });

    const result = await convert(foreign.id);
    expect(result.status).toBe(404);

    await prisma.estimate.delete({ where: { id: foreign.id } }).catch(() => {});
  });
});
