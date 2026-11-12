/**
 * Integration tests for organization settings and document numbering.
 *
 * Runs against a real PostgreSQL database and the real HTTP endpoints (CI runs
 * the built app on port 3001). Covers:
 *
 *  • settings read/write round-trip with validation and per-field errors,
 *  • clearing an optional field (and refusing to clear a required one),
 *  • partial saves leaving untouched fields alone,
 *  • cross-organization isolation (reads and writes),
 *  • permission enforcement for a member without roles,
 *  • sequential invoice numbers from the configured prefix/counter,
 *  • no renumbering or reuse when the counter is lowered,
 *  • unique numbers under concurrent creates.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const canRunTests = !!DATABASE_URL;

const describeIfDb = canRunTests ? describe : describe.skip;

const TEST_EMAIL_SUFFIX = '@settings-numbering-test.invalid';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

interface TestActor {
  userId: string;
  orgId: string;
  token: string;
}

async function createAuthenticatedUserWithOrg(
  email: string,
  name: string,
  orgName: string
): Promise<TestActor> {
  const signUpRes = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: TEST_PASSWORD, name }),
  });
  expect(signUpRes.status).toBe(200);

  const signInRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  expect(signInRes.status).toBe(200);

  const setCookie = signInRes.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/better-auth.session_token=([^;]+)/);
  const token = cookieMatch ? cookieMatch[1] : null;
  expect(token).toBeTruthy();

  const bootstrapRes = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: {
      Cookie: `better-auth.session_token=${token}`,
      'Content-Type': 'application/json',
      Origin: SERVER_URL,
      Accept: 'application/json',
    },
    body: JSON.stringify({ organizationName: orgName }),
  });
  expect(bootstrapRes.status).toBe(200);

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeDefined();
  const org = await prisma.organization.findFirst({
    where: { userRoles: { some: { userId: user!.id } } },
  });
  expect(org).toBeDefined();

  return { userId: user!.id, orgId: org!.id, token: token! };
}

function authHeaders(token: string): Record<string, string> {
  return {
    Cookie: `better-auth.session_token=${token}`,
    'Content-Type': 'application/json',
    Origin: SERVER_URL,
    Accept: 'application/json',
  };
}

async function getSettings(token: string) {
  const res = await fetch(`${SERVER_URL}/api/v1/settings/organization`, {
    headers: authHeaders(token),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function putSettings(token: string, payload: Record<string, unknown>) {
  const res = await fetch(`${SERVER_URL}/api/v1/settings/organization`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function createInvoice(token: string, title: string) {
  const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      title,
      status: 'draft',
      currency: 'USD',
      lineItems: [{ description: 'Consulting', quantity: '1', unitPrice: '100.00', taxRate: '0' }],
    }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describeIfDb('Organization settings and document numbering (real PostgreSQL)', () => {
  let admin: TestActor;
  let otherOrg: TestActor;
  let member: { userId: string; token: string };
  const createdInvoiceIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    try {
      await fetch(`${SERVER_URL}/api/auth/session`, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error(`HTTP server unavailable at ${SERVER_URL}`);
    }

    const stamp = Date.now();
    admin = await createAuthenticatedUserWithOrg(
      `settings-admin-${stamp}${TEST_EMAIL_SUFFIX}`,
      'Settings Admin',
      'Settings Test Org'
    );
    otherOrg = await createAuthenticatedUserWithOrg(
      `settings-other-${stamp}${TEST_EMAIL_SUFFIX}`,
      'Other Admin',
      'Other Test Org'
    );

    // A member of the admin's organization with no roles at all.
    const memberEmail = `settings-member-${stamp}${TEST_EMAIL_SUFFIX}`;
    const signUpRes = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ email: memberEmail, password: TEST_PASSWORD, name: 'Plain Member' }),
    });
    expect(signUpRes.status).toBe(200);

    const signInRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ email: memberEmail, password: TEST_PASSWORD }),
    });
    expect(signInRes.status).toBe(200);
    const cookie = signInRes.headers.get('set-cookie') || '';
    const match = cookie.match(/better-auth.session_token=([^;]+)/);

    const memberUser = await prisma.user.findUnique({ where: { email: memberEmail } });
    expect(memberUser).toBeDefined();
    await prisma.user.update({
      where: { id: memberUser!.id },
      data: { organizationId: admin.orgId },
    });
    member = { userId: memberUser!.id, token: match ? match[1] : '' };
  });

  afterAll(async () => {
    const orgIds = [admin?.orgId, otherOrg?.orgId].filter(Boolean) as string[];

    for (const orgId of orgIds) {
      await prisma.payment
        .deleteMany({ where: { invoice: { organizationId: orgId } } })
        .catch(() => {});
      await prisma.invoice.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.proposal.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    }

    const userIds = [admin?.userId, otherOrg?.userId, member?.userId].filter(Boolean) as string[];
    for (const userId of userIds) {
      await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
    }
    for (const orgId of orgIds) {
      await prisma.userRole.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    }
    for (const userId of userIds) {
      await prisma.user
        .update({ where: { id: userId }, data: { organizationId: null } })
        .catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    for (const orgId of orgIds) {
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  it('returns normalized settings, admin flag and the real next numbers', async () => {
    const { status, body } = await getSettings(admin.token);
    expect(status).toBe(200);

    expect(body.isAdmin).toBe(true);
    expect(body.settings.defaultCurrency).toBe('USD');
    expect(body.settings.invoiceNumberPrefix).toBe('INV');
    expect(body.settings.proposalValidDays).toBe(30);
    expect(typeof body.nextNumbers.invoice.preview).toBe('string');
    expect(body.nextNumbers.invoice.preview).toMatch(/^INV-\d{4}-\d{4,}$/);
    expect(body.nextNumbers.proposal.preview).toMatch(/^PRP-\d{4}-\d{4,}$/);
  });

  it('rejects invalid settings with per-field errors and writes nothing', async () => {
    const before = await getSettings(admin.token);

    const { status, body } = await putSettings(admin.token, {
      settings: { defaultCurrency: 'ZZZ', invoiceNextNumber: 0, brandColor: 'not-a-colour' },
    });

    expect(status).toBe(400);
    expect(body.error).toBe('Validation failed');
    expect(body.fieldErrors.defaultCurrency).toMatch(/currency/i);
    expect(body.fieldErrors.invoiceNextNumber).toMatch(/at least 1/i);
    expect(body.fieldErrors.brandColor).toMatch(/hex/i);

    const after = await getSettings(admin.token);
    expect(after.body.settings.defaultCurrency).toBe(before.body.settings.defaultCurrency);
    expect(after.body.settings.brandColor).toBe(before.body.settings.brandColor);
  });

  it('persists a partial update and leaves other fields untouched', async () => {
    const first = await putSettings(admin.token, {
      settings: { brandName: 'Acme Studio', contactEmail: 'hello@acme.test' },
    });
    expect(first.status).toBe(200);
    expect(first.body.settings.brandName).toBe('Acme Studio');
    expect(first.body.settings.contactEmail).toBe('hello@acme.test');

    const second = await putSettings(admin.token, {
      settings: { brandColor: '#7c3aed', defaultCurrency: 'pkr', invoiceNumberPrefix: 'acme' },
    });
    expect(second.status).toBe(200);
    expect(second.body.settings.brandColor).toBe('#7c3aed');
    expect(second.body.settings.defaultCurrency).toBe('PKR');
    expect(second.body.settings.invoiceNumberPrefix).toBe('ACME');

    // Untouched by the second request.
    expect(second.body.settings.brandName).toBe('Acme Studio');
    expect(second.body.settings.contactEmail).toBe('hello@acme.test');

    // Survives a fresh read (persistence across navigation/reload).
    const reloaded = await getSettings(admin.token);
    expect(reloaded.body.settings.brandName).toBe('Acme Studio');
    expect(reloaded.body.settings.brandColor).toBe('#7c3aed');
    expect(reloaded.body.settings.defaultCurrency).toBe('PKR');
  });

  it('clears an optional field but refuses to clear a required one', async () => {
    const cleared = await putSettings(admin.token, { settings: { contactEmail: '' } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.settings.contactEmail).toBeNull();

    const required = await putSettings(admin.token, { settings: { invoiceNextNumber: null } });
    expect(required.status).toBe(400);
    expect(required.body.fieldErrors.invoiceNextNumber).toMatch(/cannot be cleared/i);
  });

  it('isolates settings between organizations', async () => {
    const other = await putSettings(otherOrg.token, { settings: { brandName: 'Other Brand' } });
    expect(other.status).toBe(200);
    expect(other.body.settings.brandName).toBe('Other Brand');

    const mine = await getSettings(admin.token);
    expect(mine.body.settings.brandName).toBe('Acme Studio');
    expect(JSON.stringify(mine.body)).not.toContain('Other Brand');

    // The other organization's row is untouched by our writes.
    const otherRow = await prisma.organization.findUnique({
      where: { id: otherOrg.orgId },
      select: { settings: true },
    });
    expect((otherRow?.settings as Record<string, unknown>).brandName).toBe('Other Brand');
    expect((otherRow?.settings as Record<string, unknown>).brandColor).toBeUndefined();
  });

  it('denies settings access to a member without roles', async () => {
    const read = await getSettings(member.token);
    expect(read.status).toBe(403);

    const write = await putSettings(member.token, { settings: { brandName: 'Hijacked' } });
    expect(write.status).toBe(403);

    const row = await prisma.organization.findUnique({
      where: { id: admin.orgId },
      select: { settings: true },
    });
    expect((row?.settings as Record<string, unknown>).brandName).toBe('Acme Studio');
  });

  it('allocates sequential invoice numbers from the configured prefix and counter', async () => {
    const configured = await putSettings(admin.token, {
      settings: { invoiceNumberPrefix: 'TST', invoiceNextNumber: 500 },
    });
    expect(configured.status).toBe(200);
    expect(configured.body.nextNumbers.invoice.preview).toMatch(/^TST-\d{4}-0500$/);

    const first = await createInvoice(admin.token, 'First numbered invoice');
    expect(first.status).toBe(201);
    createdInvoiceIds.push(first.body.id);
    expect(first.body.number).toMatch(/^TST-\d{4}-0500$/);

    const second = await createInvoice(admin.token, 'Second numbered invoice');
    expect(second.status).toBe(201);
    createdInvoiceIds.push(second.body.id);
    expect(second.body.number).toMatch(/^TST-\d{4}-0501$/);

    const preview = await getSettings(admin.token);
    expect(preview.body.nextNumbers.invoice.preview).toMatch(/^TST-\d{4}-0502$/);
  });

  it('never reuses or renumbers when the counter is lowered', async () => {
    const lowered = await putSettings(admin.token, { settings: { invoiceNextNumber: 1 } });
    expect(lowered.status).toBe(200);

    // The preview and the next allocated number both continue after the highest
    // number already in use (…-0501), never from the manually lowered counter.
    expect(lowered.body.nextNumbers.invoice.preview).toMatch(/^TST-\d{4}-0502$/);

    const next = await createInvoice(admin.token, 'After lowering the counter');
    if (next.status !== 201) {
      console.log('numbering diagnostics', JSON.stringify(next.body));
      const numbers = await prisma.invoice.findMany({
        where: { organizationId: admin.orgId },
        select: { number: true },
        orderBy: { number: 'asc' },
      });
      console.log('invoice numbers', JSON.stringify(numbers));
    }
    expect(next.status).toBe(201);
    createdInvoiceIds.push(next.body.id);
    expect(next.body.number).toMatch(/^TST-\d{4}-0502$/);
  });

  it('issues unique numbers for concurrent creations', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        createInvoice(admin.token, `Concurrent invoice ${index + 1}`)
      )
    );

    for (const result of results) {
      expect(result.status).toBe(201);
      createdInvoiceIds.push(result.body.id);
    }

    const numbers = results.map((result) => result.body.number as string);
    expect(new Set(numbers).size).toBe(numbers.length);

    const rows = await prisma.invoice.findMany({
      where: { organizationId: admin.orgId, number: { in: numbers } },
      select: { number: true },
    });
    expect(rows).toHaveLength(numbers.length);
  });
});
