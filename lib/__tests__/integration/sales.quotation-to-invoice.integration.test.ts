/**
 * Integration: approved sales workflow — Quotation → Invoice, with the optional
 * Quotation → Agreement → Invoice path (real PostgreSQL + live HTTP routes).
 *
 * Pins the behaviour the workflow promises:
 *
 *  1. a quotation can be created directly, without a proposal;
 *  2. an accepted quotation creates a draft invoice with the client, line
 *     items, unit prices, tax rates, currency and notes copied from the source,
 *     and the totals recalculated server-side;
 *  3. the source quotation link is preserved on the invoice (and visible from
 *     the quotation), and the direct path needs no proposal or agreement;
 *  4. an accepted quotation can first create an agreement (idempotently), which
 *     preserves the same source link, and can still create an invoice afterwards;
 *  5. non-accepted quotations are rejected;
 *  6. the existing permissions and organization scoping still apply: a viewer
 *     without `invoice.create`/`contract.create` gets 403, and another tenant
 *     gets the same non-disclosing 404 as a missing id.
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import {
  authHeaders,
  cleanupOrganizations,
  createMemberWithPermissions,
  createOrganizationWithAdmin,
  jsonFetch,
  type TestAccount,
} from './batch4-provisioning';

const canRun = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
const describeIfDb = canRun ? describe : describe.skip;

type QuotationBody = {
  id: string;
  number: string;
  status: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  contactId: string | null;
  invoices?: Array<{ id: string; number: string }>;
  contracts?: Array<{ id: string; title: string; status: string }>;
};

type InvoiceBody = {
  id: string;
  number: string;
  status: string;
  clientId: string | null;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  notes: string | null;
  quotationId: string | null;
  quotation: { id: string; number: string; title: string } | null;
  items: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    taxRate: string;
    amount: string;
  }>;
};

type AgreementBody = {
  id: string;
  title: string;
  status: string;
  quotationId: string | null;
  quotation: { id: string; number: string; title: string } | null;
};

describeIfDb('Approved sales workflow: quotation to invoice (real PostgreSQL)', () => {
  const orgIdsToCleanup: string[] = [];
  let orgA: TestAccount;
  let orgB: TestAccount;
  let viewerA: TestAccount;
  let contactAId = '';

  const lineItems = [
    {
      description: 'Brand Strategy & Design System',
      quantity: '2',
      unitPrice: '1500',
      taxRate: '10',
      sortOrder: 0,
    },
    {
      description: 'Launch Workshop',
      quantity: '1',
      unitPrice: '500',
      taxRate: '0',
      sortOrder: 1,
    },
  ];

  const createQuotation = async (
    account: TestAccount,
    overrides: Record<string, unknown> = {}
  ): Promise<QuotationBody> => {
    const res = await jsonFetch('/api/v1/crm/quotations', {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify({
        // Deliberately no proposalId/opportunityId: the quotation is created
        // directly, which is the supported entry point of the workflow.
        contactId: contactAId,
        title: 'Enterprise Brand Refresh',
        currency: 'EUR',
        notes: 'Scope agreed on the kickoff call',
        lineItems,
        ...overrides,
      }),
    });
    expect(res.status, `quotation create failed: ${JSON.stringify(res.body)}`).toBe(201);
    return res.body as QuotationBody;
  };

  const acceptQuotation = async (account: TestAccount, quotationId: string): Promise<void> => {
    const sent = await jsonFetch(`/api/v1/crm/quotations/${quotationId}`, {
      method: 'PUT',
      headers: authHeaders(account.token),
      body: JSON.stringify({ status: 'sent' }),
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const accepted = await jsonFetch(`/api/v1/crm/quotations/${quotationId}`, {
      method: 'PUT',
      headers: authHeaders(account.token),
      body: JSON.stringify({ status: 'accepted' }),
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect((accepted.body as QuotationBody).status).toBe('accepted');
  };

  const createInvoiceFromQuotation = async (
    account: TestAccount,
    quotationId: string,
    body: Record<string, unknown> = {}
  ) =>
    jsonFetch(`/api/v1/crm/quotations/${quotationId}/invoice`, {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify(body),
    });

  const createAgreementFromQuotation = async (
    account: TestAccount,
    quotationId: string,
    body: Record<string, unknown> = {}
  ) =>
    jsonFetch(`/api/v1/crm/quotations/${quotationId}/agreement`, {
      method: 'POST',
      headers: authHeaders(account.token),
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    await prisma.$connect();

    // Permission catalog rows this workflow relies on. Bootstrap seeds them in
    // production; the suite makes sure they exist before assigning roles.
    const requiredPermCodes = [
      'quotation.create',
      'quotation.read',
      'quotation.update',
      'invoice.create',
      'invoice.read',
      'contract.create',
      'contract.read',
    ];
    await prisma.permission.createMany({
      data: requiredPermCodes.map((code) => ({ code, description: `Permission: ${code}` })),
      skipDuplicates: true,
    });

    orgA = await createOrganizationWithAdmin('sales-workflow-a');
    orgIdsToCleanup.push(orgA.organizationId);

    orgB = await createOrganizationWithAdmin('sales-workflow-b');
    orgIdsToCleanup.push(orgB.organizationId);

    // A member who can read quotations but cannot create invoices/agreements.
    viewerA = await createMemberWithPermissions(orgA.organizationId, 'sales-viewer', [
      'quotation.read',
      'invoice.read',
      'contract.read',
    ]);

    const contact = await prisma.contact.create({
      data: {
        organizationId: orgA.organizationId,
        firstName: 'Elena',
        lastName: 'Rostova',
        email: `elena-${Date.now()}@sales-workflow.invalid`,
        status: 'active',
        createdBy: orgA.userId,
        updatedBy: orgA.userId,
      },
    });
    contactAId = contact.id;
  });

  afterAll(async () => {
    await cleanupOrganizations(orgIdsToCleanup);
  });

  it('creates a quotation without a proposal and invoices it directly', async () => {
    const quotation = await createQuotation(orgA);
    expect(quotation.id).toBeTruthy();
    expect(quotation.status).toBe('draft');
    // Server-calculated: 2 * 1500 = 3000 + 10% = 300 tax; 1 * 500 = 500.
    expect(quotation.subtotal).toBe('3500.00');
    expect(quotation.tax).toBe('300.00');
    expect(quotation.total).toBe('3800.00');

    await acceptQuotation(orgA, quotation.id);

    const invoiceRes = await createInvoiceFromQuotation(orgA, quotation.id);
    expect(invoiceRes.status, JSON.stringify(invoiceRes.body)).toBe(201);
    const invoice = invoiceRes.body as InvoiceBody;

    // Source data is copied from the quotation, and the invoice starts as a draft.
    expect(invoice.status).toBe('draft');
    expect(invoice.clientId).toBe(contactAId);
    expect(invoice.currency).toBe('EUR');
    expect(invoice.subtotal).toBe('3500.00');
    expect(invoice.tax).toBe('300.00');
    expect(invoice.total).toBe('3800.00');
    expect(invoice.notes).toBe('Scope agreed on the kickoff call');
    expect(invoice.number).toMatch(/^[A-Z]+-\d{4}-\d{4}$/);

    expect(
      invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        amount: item.amount,
      }))
    ).toEqual([
      {
        description: 'Brand Strategy & Design System',
        quantity: '2',
        unitPrice: '1500.00',
        taxRate: '10',
        amount: '3000.00',
      },
      {
        description: 'Launch Workshop',
        quantity: '1',
        unitPrice: '500.00',
        taxRate: '0',
        amount: '500.00',
      },
    ]);

    // The source quotation link is preserved and exposed on the invoice.
    expect(invoice.quotationId).toBe(quotation.id);
    expect(invoice.quotation).toEqual({
      id: quotation.id,
      number: quotation.number,
      title: 'Enterprise Brand Refresh',
    });

    // ... and the source sees the invoice it produced.
    const quotationAfter = await jsonFetch(`/api/v1/crm/quotations/${quotation.id}`, {
      headers: authHeaders(orgA.token),
    });
    expect(quotationAfter.status).toBe(200);
    expect((quotationAfter.body as QuotationBody).invoices?.map((row) => row.id)).toContain(
      invoice.id
    );
  });

  it('supports Quotation → Agreement → Invoice and keeps the source link on both', async () => {
    const quotation = await createQuotation(orgA, { title: 'Retainer Agreement Scope' });
    await acceptQuotation(orgA, quotation.id);

    const agreementRes = await createAgreementFromQuotation(orgA, quotation.id);
    expect(agreementRes.status, JSON.stringify(agreementRes.body)).toBe(201);
    const agreement = agreementRes.body as AgreementBody;
    expect(agreement.status).toBe('draft');
    expect(agreement.title).toBe('Retainer Agreement Scope Agreement');
    expect(agreement.quotationId).toBe(quotation.id);
    expect(agreement.quotation?.id).toBe(quotation.id);

    // A second create returns the same agreement instead of duplicating it.
    const repeated = await createAgreementFromQuotation(orgA, quotation.id);
    expect(repeated.status).toBe(201);
    expect((repeated.body as AgreementBody).id).toBe(agreement.id);

    // The invoice can be created after the agreement, from the same quotation.
    const invoiceRes = await createInvoiceFromQuotation(orgA, quotation.id);
    expect(invoiceRes.status, JSON.stringify(invoiceRes.body)).toBe(201);
    const invoice = invoiceRes.body as InvoiceBody;
    expect(invoice.quotationId).toBe(quotation.id);
    expect(invoice.total).toBe('3800.00');

    const quotationAfter = await jsonFetch(`/api/v1/crm/quotations/${quotation.id}`, {
      headers: authHeaders(orgA.token),
    });
    const body = quotationAfter.body as QuotationBody;
    expect(body.contracts?.map((row) => row.id)).toContain(agreement.id);
    expect(body.invoices?.map((row) => row.id)).toContain(invoice.id);
    // Only one agreement exists despite the repeated request.
    expect(body.contracts).toHaveLength(1);
  });

  it('refuses to invoice or sign an agreement from a quotation that is not accepted', async () => {
    const quotation = await createQuotation(orgA, { title: 'Still Draft' });

    const invoiceRes = await createInvoiceFromQuotation(orgA, quotation.id);
    expect(invoiceRes.status).toBe(400);
    expect(String((invoiceRes.body as { error?: string }).error)).toMatch(/accepted quotations/i);

    const agreementRes = await createAgreementFromQuotation(orgA, quotation.id);
    expect(agreementRes.status).toBe(400);
    expect(String((agreementRes.body as { error?: string }).error)).toMatch(/accepted quotations/i);
  });

  it('enforces permissions and organization scoping', async () => {
    const quotation = await createQuotation(orgA, { title: 'Scoped Workflow' });
    await acceptQuotation(orgA, quotation.id);

    // A viewer may read the quotation and invoices, but cannot create either
    // target document.
    const viewerQuotation = await jsonFetch(`/api/v1/crm/quotations/${quotation.id}`, {
      headers: authHeaders(viewerA.token),
    });
    expect(viewerQuotation.status).toBe(200);

    const viewerInvoice = await createInvoiceFromQuotation(viewerA, quotation.id);
    expect(viewerInvoice.status).toBe(403);

    const viewerAgreement = await createAgreementFromQuotation(viewerA, quotation.id);
    expect(viewerAgreement.status).toBe(403);

    // Another tenant cannot even see the quotation, and therefore cannot create
    // documents from it: same non-disclosing 404 as a missing id.
    const foreignQuotation = await jsonFetch(`/api/v1/crm/quotations/${quotation.id}`, {
      headers: authHeaders(orgB.token),
    });
    expect(foreignQuotation.status).toBe(404);

    const foreignInvoice = await createInvoiceFromQuotation(orgB, quotation.id);
    expect(foreignInvoice.status).toBe(404);

    const foreignAgreement = await createAgreementFromQuotation(orgB, quotation.id);
    expect(foreignAgreement.status).toBe(404);

    // The invoice that org A created stays inside org A.
    const invoiceRes = await createInvoiceFromQuotation(orgA, quotation.id);
    expect(invoiceRes.status).toBe(201);
    const invoice = invoiceRes.body as InvoiceBody;

    const ownerRead = await jsonFetch(`/api/v1/crm/invoices/${invoice.id}`, {
      headers: authHeaders(orgA.token),
    });
    expect(ownerRead.status).toBe(200);

    const viewerRead = await jsonFetch(`/api/v1/crm/invoices/${invoice.id}`, {
      headers: authHeaders(viewerA.token),
    });
    expect(viewerRead.status).toBe(200);

    const foreignRead = await jsonFetch(`/api/v1/crm/invoices/${invoice.id}`, {
      headers: authHeaders(orgB.token),
    });
    expect(foreignRead.status).toBe(404);

    // The source link never crosses a tenant boundary at the database level.
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.organizationId).toBe(orgA.organizationId);
    expect(stored.quotationId).toBe(quotation.id);
  });
});
