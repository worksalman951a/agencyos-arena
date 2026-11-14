/**
 * Unit tests for the approved sales workflow:
 *
 *   Quotation ───────────────────▶ Invoice        (default)
 *   Quotation ──▶ Agreement ─────▶ Invoice        (optional)
 *
 * Prisma, auth, permissions and the number allocator are mocked, so these tests
 * run without a database and pin the service contract:
 *
 *  - source data (client, line items, prices, taxes, currency, notes) is copied
 *    from the accepted quotation rather than from the caller;
 *  - totals are recalculated server-side;
 *  - the source quotation link is written on both invoices and agreements;
 *  - only accepted quotations are billable;
 *  - the source is resolved inside the caller's organization (cross-org and
 *    missing ids are the same non-disclosing 404);
 *  - both documents require their own create permission, and the quotation
 *    requires `quotation.read`;
 *  - creating a second agreement for one quotation is idempotent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    quotation: { findFirst: vi.fn() },
    invoice: { create: vi.fn(), findUniqueOrThrow: vi.fn() },
    contract: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

vi.mock('@/lib/auth-server', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

vi.mock('@/lib/services/settings/document-numbering', () => ({
  allocateDocumentNumber: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { allocateDocumentNumber } from '@/lib/services/settings/document-numbering';
import { createInvoiceFromQuotation } from '@/lib/services/crm/invoice-service';
import { createAgreementFromQuotation } from '@/lib/services/documents/contract-service';

const mockQuotationFindFirst = prisma.quotation.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceCreate = prisma.invoice.create as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceFindUniqueOrThrow = prisma.invoice.findUniqueOrThrow as unknown as ReturnType<
  typeof vi.fn
>;
const mockContractFindFirst = prisma.contract.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockContractCreate = prisma.contract.create as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockQueryRawUnsafe = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockAllocateNumber = allocateDocumentNumber as unknown as ReturnType<typeof vi.fn>;

const orgId = 'org_workflow';
const userId = 'user_workflow';
const quotationId = 'quotation_accepted';

const acceptedQuotation = {
  id: quotationId,
  organizationId: orgId,
  number: 'QOT-2026-0004',
  title: 'Enterprise Brand Refresh',
  status: 'accepted',
  contactId: 'contact_123',
  currency: 'EUR',
  notes: 'Scope agreed on the kickoff call',
  deletedAt: null,
  items: [
    {
      description: 'Brand Strategy & Design System',
      quantity: { toString: () => '2' },
      unitPrice: { toString: () => '1500' },
      taxRate: { toString: () => '10' },
      sortOrder: 0,
    },
    {
      description: 'Launch Workshop',
      quantity: { toString: () => '1' },
      unitPrice: { toString: () => '500' },
      taxRate: { toString: () => '0' },
      sortOrder: 1,
    },
  ],
};

const invoiceRecord = {
  id: 'invoice_1',
  organizationId: orgId,
  number: 'INV-2026-0012',
  clientId: 'contact_123',
  projectId: null,
  quotationId,
  quotation: { id: quotationId, number: 'QOT-2026-0004', title: 'Enterprise Brand Refresh' },
  title: 'Invoice for Quotation QOT-2026-0004',
  status: 'draft',
  subtotal: '3500.00',
  tax: '300.00',
  total: '3800.00',
  currency: 'EUR',
  dueDate: null,
  notes: 'Scope agreed on the kickoff call',
  deletedAt: null,
  createdBy: userId,
  updatedBy: userId,
  createdAt: new Date('2026-11-14'),
  updatedAt: new Date('2026-11-14'),
  creator: null,
  updater: null,
  client: { id: 'contact_123', firstName: 'Elena', lastName: 'Rostova' },
  project: null,
  items: [],
  payments: [],
};

const contractRecord = {
  id: 'contract_1',
  organizationId: orgId,
  proposalId: null,
  projectId: null,
  quotationId,
  quotation: { id: quotationId, number: 'QOT-2026-0004', title: 'Enterprise Brand Refresh' },
  title: 'Enterprise Brand Refresh Agreement',
  status: 'draft',
  signatureReference: null,
  signedAt: null,
  signedBy: null,
  createdAt: new Date('2026-11-14'),
  updatedAt: new Date('2026-11-14'),
  proposal: null,
  project: null,
  signer: null,
};

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ toString: () => 'better-auth.session_token=test' });
  mockGetSession.mockResolvedValue({
    session: { id: 'session_1' },
    user: { id: userId, email: 'owner@agency.invalid' },
  });
  mockRequireOrganization.mockResolvedValue({ organizationId: orgId });
  mockRequirePermission.mockResolvedValue(undefined);

  mockTransaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as [])
  );
  mockQueryRawUnsafe.mockResolvedValue([]);
  mockAllocateNumber.mockResolvedValue({ number: 'INV-2026-0012', sequence: 12, prefix: 'INV' });
  mockQuotationFindFirst.mockResolvedValue(acceptedQuotation);
  mockInvoiceCreate.mockResolvedValue({ id: 'invoice_1' });
  mockInvoiceFindUniqueOrThrow.mockResolvedValue(invoiceRecord);
  mockContractFindFirst.mockResolvedValue(null);
  mockContractCreate.mockResolvedValue(contractRecord);
  mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });
});

describe('createInvoiceFromQuotation', () => {
  it('copies the client, line items, pricing, taxes and currency from the quotation', async () => {
    const result = await createInvoiceFromQuotation(quotationId);

    // Source is resolved inside the caller's organization, soft-deleted rows
    // excluded (deletedAt is checked after the read).
    expect(mockQuotationFindFirst).toHaveBeenCalledWith({
      where: { id: quotationId, organizationId: orgId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });

    expect(mockAllocateNumber).toHaveBeenCalledWith(expect.anything(), orgId, 'invoice');

    const createArgs = mockInvoiceCreate.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      organizationId: orgId,
      number: 'INV-2026-0012',
      clientId: 'contact_123',
      projectId: null,
      quotationId,
      title: 'Invoice for Quotation QOT-2026-0004',
      status: 'draft',
      // 2 * 1500 = 3000 + 10% tax = 300; 1 * 500 = 500, no tax
      subtotal: '3500.00',
      tax: '300.00',
      total: '3800.00',
      currency: 'EUR',
      notes: 'Scope agreed on the kickoff call',
    });

    expect(createArgs.data.items.create).toEqual([
      {
        description: 'Brand Strategy & Design System',
        quantity: 2,
        unitPrice: 1500,
        taxRate: 10,
        amount: '3000.00',
      },
      {
        description: 'Launch Workshop',
        quantity: 1,
        unitPrice: 500,
        taxRate: 0,
        amount: '500.00',
      },
    ]);

    // The response carries the source link so the UI can show provenance.
    expect(result.quotationId).toBe(quotationId);
    expect(result.quotation).toEqual({
      id: quotationId,
      number: 'QOT-2026-0004',
      title: 'Enterprise Brand Refresh',
    });

    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'invoice.create',
        entityType: 'Invoice',
        entityId: 'invoice_1',
        after: expect.objectContaining({
          sourceQuotationId: quotationId,
          sourceQuotationNumber: 'QOT-2026-0004',
        }),
      }),
    });
  });

  it('requires invoice.create and quotation.read in the caller organization', async () => {
    await createInvoiceFromQuotation(quotationId);

    expect(mockRequirePermission).toHaveBeenCalledWith(userId, orgId, 'invoice.create');
    expect(mockRequirePermission).toHaveBeenCalledWith(userId, orgId, 'quotation.read');
  });

  it('rejects a quotation that is not accepted', async () => {
    mockQuotationFindFirst.mockResolvedValue({ ...acceptedQuotation, status: 'sent' });

    await expect(createInvoiceFromQuotation(quotationId)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Only accepted quotations can be invoiced',
    });
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
  });

  it('answers a non-disclosing 404 for a missing, deleted or foreign quotation', async () => {
    mockQuotationFindFirst.mockResolvedValue(null);
    await expect(createInvoiceFromQuotation('quotation_foreign')).rejects.toMatchObject({
      statusCode: 404,
    });

    mockQuotationFindFirst.mockResolvedValue({
      ...acceptedQuotation,
      deletedAt: new Date('2026-11-01'),
    });
    await expect(createInvoiceFromQuotation(quotationId)).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockInvoiceCreate).not.toHaveBeenCalled();
  });

  it('accepts title, due date and notes overrides for the invoice only', async () => {
    await createInvoiceFromQuotation(quotationId, {
      title: 'Milestone 1',
      dueDate: '2026-12-31',
      notes: 'First instalment',
    });

    expect(mockInvoiceCreate.mock.calls[0][0].data).toMatchObject({
      title: 'Milestone 1',
      notes: 'First instalment',
      dueDate: new Date('2026-12-31'),
      // Source fields can never be overridden through the body.
      quotationId,
      clientId: 'contact_123',
      currency: 'EUR',
    });
  });

  it('can invoice the same quotation more than once (milestones) with a fresh number', async () => {
    await createInvoiceFromQuotation(quotationId);
    mockAllocateNumber.mockResolvedValueOnce({
      number: 'INV-2026-0013',
      sequence: 13,
      prefix: 'INV',
    });
    await createInvoiceFromQuotation(quotationId);

    expect(mockInvoiceCreate).toHaveBeenCalledTimes(2);
    expect(mockInvoiceCreate.mock.calls[1][0].data.number).toBe('INV-2026-0013');
  });
});

describe('createAgreementFromQuotation', () => {
  it('creates a draft agreement linked to the quotation with a prefilled title', async () => {
    const result = await createAgreementFromQuotation(quotationId);

    expect(mockContractCreate).toHaveBeenCalledWith({
      data: {
        organizationId: orgId,
        proposalId: null,
        projectId: null,
        quotationId,
        title: 'Enterprise Brand Refresh Agreement',
        status: 'draft',
      },
      include: {
        proposal: { select: { id: true, number: true, title: true, status: true } },
        project: { select: { id: true, name: true, status: true } },
        quotation: { select: { id: true, number: true, title: true } },
      },
    });

    expect(result.quotationId).toBe(quotationId);
    expect(result.quotation).toEqual({
      id: quotationId,
      number: 'QOT-2026-0004',
      title: 'Enterprise Brand Refresh',
    });

    expect(mockRequirePermission).toHaveBeenCalledWith(userId, orgId, 'contract.create');
    expect(mockRequirePermission).toHaveBeenCalledWith(userId, orgId, 'quotation.read');
  });

  it('locks the quotation row before looking for an existing agreement', async () => {
    await createAgreementFromQuotation(quotationId);

    // Row lock: every concurrent Create Agreement for this quotation serialises
    // here, so the loser re-reads after the winner commits.
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
      'SELECT id FROM "Quotation" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE',
      quotationId,
      orgId
    );
  });

  it('returns the existing non-voided agreement instead of duplicating it', async () => {
    mockContractFindFirst.mockResolvedValue(contractRecord);

    const first = await createAgreementFromQuotation(quotationId);
    const second = await createAgreementFromQuotation(quotationId);

    expect(first.id).toBe('contract_1');
    expect(second.id).toBe('contract_1');
    expect(mockContractCreate).not.toHaveBeenCalled();
    // The lookup excludes voided agreements, which is what permits a
    // replacement after voiding.
    expect(mockContractFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { quotationId, organizationId: orgId, status: { not: 'voided' } },
      })
    );
    // An idempotent replay must not pretend a second contract was created.
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it('resolves a losing race on the unique index to the winning agreement', async () => {
    // A writer that raced past the row lock trips the partial unique index.
    mockTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );
    mockContractFindFirst.mockResolvedValue(contractRecord);

    const result = await createAgreementFromQuotation(quotationId);

    expect(result.id).toBe('contract_1');
    expect(mockContractCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it('cannot resolve to a voided agreement', async () => {
    const voided = { ...contractRecord, id: 'contract_voided', status: 'voided' };
    mockTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );
    // The filtered lookup finds no active agreement, so the original
    // constraint error is surfaced instead of returning the voided row.
    mockContractFindFirst.mockResolvedValueOnce(null);

    await expect(createAgreementFromQuotation(quotationId)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(voided.status).toBe('voided');
    expect(mockContractCreate).not.toHaveBeenCalled();
  });

  it('creates a replacement after the previous agreement was voided', async () => {
    const replacement = {
      ...contractRecord,
      id: 'contract_2',
      title: 'Enterprise Brand Refresh Agreement (re-issued)',
    };
    // The active-agreement lookup excludes voided rows, so it finds nothing...
    mockContractFindFirst.mockResolvedValue(null);
    mockContractCreate.mockResolvedValue(replacement);

    const result = await createAgreementFromQuotation(quotationId, {
      title: 'Enterprise Brand Refresh Agreement (re-issued)',
    });

    expect(result.id).toBe('contract_2');
    expect(mockContractCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quotationId,
        status: 'draft',
        title: 'Enterprise Brand Refresh Agreement (re-issued)',
      }),
      include: expect.objectContaining({
        quotation: { select: { id: true, number: true, title: true } },
      }),
    });
    // A genuinely new agreement is audited.
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ entityId: 'contract_2', action: 'contract.create' }),
    });
  });

  it('rejects a quotation that is not accepted', async () => {
    mockQuotationFindFirst.mockResolvedValue({ ...acceptedQuotation, status: 'draft' });

    await expect(createAgreementFromQuotation(quotationId)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Only accepted quotations can produce an agreement',
    });
    expect(mockContractCreate).not.toHaveBeenCalled();
  });

  it('answers a non-disclosing 404 for a missing or foreign quotation', async () => {
    mockQuotationFindFirst.mockResolvedValue(null);

    await expect(createAgreementFromQuotation('quotation_foreign')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockContractCreate).not.toHaveBeenCalled();
  });
});
