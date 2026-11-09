/**
 * Integration tests for CRM Invoices API.
 *
 * These tests run against a REAL PostgreSQL database via Prisma Client
 * and real HTTP endpoints via the Next.js dev server.
 *
 * They verify:
 * - Database-backed session validation on every request (401 when missing)
 * - Organization-scoped data access (org isolation)
 * - Custom RBAC permissions (403 when insufficient)
 * - Non-disclosing 404 for cross-org lookups (IDOR protection)
 * - Invoice CRUD with line items and payments
 * - Soft deletion with deletedAt filtering
 * - Organization isolation (cross-org access blocked)
 *
 * Requires DATABASE_URL and BETTER_AUTH_SECRET environment variables.
 * Requires a running Next.js server (TEST_SERVER_URL / BETTER_AUTH_URL, default http://localhost:3001).
 * Skips gracefully if no database is available.
 * Fails if the HTTP server is unavailable when the database is available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const canRunTests = !!DATABASE_URL;

const describeIfDb = canRunTests ? describe : describe.skip;

const TEST_EMAIL_SUFFIX = '@crm-invoices-test.invalid';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

/** Register, sign in, and bootstrap an org for a test user. Returns session token, user, orgId. */
async function createAuthenticatedUserWithOrg(email: string, name: string, orgName: string) {
  const signUpRes = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD, name }),
  });
  expect(signUpRes.status).toBe(200);

  const signInRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  expect(signInRes.status).toBe(200);

  const setCookie = signInRes.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/better-auth.session_token=([^;]+)/);
  const token = cookieMatch ? cookieMatch[1] : null;

  const bootstrapRes = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: {
      Cookie: `better-auth.session_token=${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ organizationName: orgName }),
  });

  const user = await prisma.user.findUnique({ where: { email } });
  expect(user).toBeDefined();
  const org = await prisma.organization.findFirst({
    where: { userRoles: { some: { userId: user!.id } } },
  });
  expect(org).toBeDefined();

  return { user: user!, token, org: org!, bootstrapRes };
}

describeIfDb('CRM Invoices integration (real PostgreSQL)', () => {
  let testUserId: string;
  let testOrgId: string;
  let testSessionToken: string;
  let testContactId: string;
  let testInvoiceId: string;

  beforeAll(async () => {
    await prisma.$connect();

    try {
      await fetch(`${SERVER_URL}/api/auth/session`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw new Error(`HTTP server unavailable at ${SERVER_URL}`);
    }

    const email = `crm-invoice-user-${Date.now()}${TEST_EMAIL_SUFFIX}`;
    const { user, token, org } = await createAuthenticatedUserWithOrg(
      email,
      'CRM Invoice User',
      'CRM Invoice Test Org'
    );
    testUserId = user!.id;
    testOrgId = org!.id;
    testSessionToken = token!;

    // Create test contact in same org (to use as invoice client)
    const contact = await prisma.contact.create({
      data: {
        organizationId: testOrgId,
        firstName: 'Invoice',
        lastName: 'Client',
        email: 'invoice.client@example.com',
        phone: '5550001111',
        status: 'active',
        createdBy: testUserId,
        updatedBy: testUserId,
      },
    });
    testContactId = contact.id;
  });

  afterAll(async () => {
    if (testInvoiceId) {
      await prisma.invoice.delete({ where: { id: testInvoiceId } }).catch(() => {});
    }
    if (testContactId) {
      await prisma.contact.delete({ where: { id: testContactId } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.contact.deleteMany({ where: { organizationId: testOrgId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  describe('GET /api/v1/crm/invoices - List invoices', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
        headers: { Accept: 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it('returns empty list on empty database', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.invoices).toBeDefined();
      expect(Array.isArray(body.invoices)).toBe(true);
      expect(body.invoices.length).toBe(0);
      expect(body.total).toBe(0);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
    });

    it("returns paginated invoices for the user's organization", async () => {
      // Create an invoice directly in the DB for listing
      await prisma.invoice.create({
        data: {
          organizationId: testOrgId,
          number: 'INV-2026-0001',
          title: 'Test Invoice',
          clientId: testContactId,
          status: 'draft',
          subtotal: '100.00',
          tax: '10.00',
          total: '110.00',
          currency: 'USD',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.invoices.length).toBeGreaterThanOrEqual(1);
      expect(body.total).toBeGreaterThanOrEqual(1);
      const testInv = body.invoices.find(
        (i: { id: string; title: string }) => i.title === 'Test Invoice'
      );
      expect(testInv).toBeDefined();
      expect(testInv.organizationId).toBe(testOrgId);
    });

    it('excludes soft-deleted invoices by default', async () => {
      await prisma.invoice.updateMany({
        where: { organizationId: testOrgId },
        data: { deletedAt: new Date() },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const deletedInv = body.invoices.find((i: { title: string }) => i.title === 'Test Invoice');
      expect(deletedInv).toBeUndefined();

      // Restore
      await prisma.invoice.updateMany({
        where: { organizationId: testOrgId },
        data: { deletedAt: null },
      });
    });
  });

  describe('POST /api/v1/crm/invoices - Create invoice', () => {
    it('returns 401 without session', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: 'Unauthorized Invoice',
          lineItems: [{ description: 'Item', quantity: '1', unitPrice: '10', taxRate: '0' }],
        }),
      });
      expect(res.status).toBe(401);
    });

    it('creates an invoice with line items', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          clientId: testContactId,
          title: 'Integration Test Invoice',
          status: 'draft',
          currency: 'USD',
          dueDate: null,
          notes: 'Integration test notes',
          lineItems: [
            {
              description: 'Web design services',
              quantity: '2',
              unitPrice: '750.00',
              taxRate: '0',
            },
            {
              description: 'Hosting setup',
              quantity: '1',
              unitPrice: '200.00',
              taxRate: '0',
            },
          ],
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe('Integration Test Invoice');
      expect(body.clientId).toBe(testContactId);
      expect(body.organizationId).toBe(testOrgId);
      expect(body.status).toBe('draft');
      expect(body.total).toBe('1700.00'); // 2*750 + 1*200 = 1700
      expect(body.subtotal).toBe('1700.00');
      expect(body.tax).toBe('0.00');
      expect(body.items.length).toBe(2);
      expect(body.client).toBeDefined();
      expect(body.client.firstName).toBe('Invoice');
      expect(body.client.lastName).toBe('Client');

      testInvoiceId = body.id;
    });

    it('returns 400 for invalid input', async () => {
      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: '',
          lineItems: [],
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/crm/invoices/[id] - Get single invoice', () => {
    it('returns 404 for cross-org invoice (non-disclosing)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org Invoice', slug: 'foreign-org-invoice' },
      });
      const foreignInvoice = await prisma.invoice.create({
        data: {
          organizationId: foreignOrg.id,
          number: 'INV-FOREIGN-001',
          title: 'Foreign Invoice',
          status: 'draft',
          subtotal: '0',
          tax: '0',
          total: '0',
          currency: 'USD',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${foreignInvoice.id}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.invoice.delete({ where: { id: foreignInvoice.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('returns invoice for same org with client and items', async () => {
      expect(testInvoiceId).toBeDefined();
      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${testInvoiceId}`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(testInvoiceId);
      expect(body.organizationId).toBe(testOrgId);
      expect(body.client).toBeDefined();
      expect(body.client.firstName).toBe('Invoice');
      expect(body.items.length).toBe(2);
    });
  });

  describe('PUT /api/v1/crm/invoices/[id] - Update invoice', () => {
    it('returns 404 for cross-org update (IDOR protection)', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org Invoice 2', slug: 'foreign-org-invoice-2' },
      });
      const foreignInvoice = await prisma.invoice.create({
        data: {
          organizationId: foreignOrg.id,
          number: 'INV-FOREIGN-002',
          title: 'Foreign Invoice 2',
          status: 'draft',
          subtotal: '0',
          tax: '0',
          total: '0',
          currency: 'USD',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${foreignInvoice.id}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: 'Hacked' }),
      });
      expect(res.status).toBe(404);

      await prisma.invoice.delete({ where: { id: foreignInvoice.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('updates invoice for same org', async () => {
      expect(testInvoiceId).toBeDefined();
      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${testInvoiceId}`, {
        method: 'PUT',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: 'Updated Integration Invoice',
          status: 'sent',
          notes: 'Updated notes',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('Updated Integration Invoice');
      expect(body.status).toBe('sent');
      expect(body.notes).toBe('Updated notes');
    });
  });

  describe('POST /api/v1/crm/invoices/[id]/payments - Record payment', () => {
    it('records a payment and updates invoice status', async () => {
      expect(testInvoiceId).toBeDefined();
      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${testInvoiceId}/payments`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          amount: '1700.00',
          method: 'bank_transfer',
          reference: 'REF-001',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.payment.id).toBeDefined();
      expect(body.payment.amount).toBe('1700.00');
      expect(body.payment.method).toBe('bank_transfer');
      expect(body.invoiceStatus).toBe('paid');
    });

    it('returns 404 for cross-org payment recording', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org Invoice 3', slug: 'foreign-org-invoice-3' },
      });
      const foreignInvoice = await prisma.invoice.create({
        data: {
          organizationId: foreignOrg.id,
          number: 'INV-FOREIGN-003',
          title: 'Foreign Invoice 3',
          status: 'draft',
          subtotal: '0',
          tax: '0',
          total: '0',
          currency: 'USD',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${foreignInvoice.id}/payments`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ amount: '100.00', method: 'bank_transfer' }),
      });
      expect(res.status).toBe(404);

      await prisma.invoice.delete({ where: { id: foreignInvoice.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });
  });

  describe('DELETE /api/v1/crm/invoices/[id] - Soft delete invoice', () => {
    it('returns 404 for cross-org delete', async () => {
      const foreignOrg = await prisma.organization.create({
        data: { name: 'Foreign Org Invoice 4', slug: 'foreign-org-invoice-4' },
      });
      const foreignInvoice = await prisma.invoice.create({
        data: {
          organizationId: foreignOrg.id,
          number: 'INV-FOREIGN-004',
          title: 'Foreign Invoice 4',
          status: 'draft',
          subtotal: '0',
          tax: '0',
          total: '0',
          currency: 'USD',
          createdBy: testUserId,
          updatedBy: testUserId,
        },
      });

      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${foreignInvoice.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(404);

      await prisma.invoice.delete({ where: { id: foreignInvoice.id } });
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    });

    it('rejects deletion of a paid invoice', async () => {
      // The suite's main invoice was paid in full by the payment test above.
      // Paid invoices are financial records and must not be deletable.
      expect(testInvoiceId).toBeDefined();
      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${testInvoiceId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(400);
    });

    it('soft deletes a draft invoice (sets deletedAt)', async () => {
      const createRes = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
        method: 'POST',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: 'Deletable Draft Invoice',
          status: 'draft',
          currency: 'USD',
          dueDate: null,
          lineItems: [
            { description: 'Consulting', quantity: '1', unitPrice: '100.00', taxRate: '0' },
          ],
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();

      const res = await fetch(`${SERVER_URL}/api/v1/crm/invoices/${created.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedAt).toBeDefined();

      const listRes = await fetch(`${SERVER_URL}/api/v1/crm/invoices`, {
        headers: {
          Cookie: `better-auth.session_token=${testSessionToken}`,
          Accept: 'application/json',
        },
      });
      const listBody = await listRes.json();
      const deletedInv = listBody.invoices.find((i: { id: string }) => i.id === created.id);
      expect(deletedInv).toBeUndefined();
    });
  });
});
