/** Unit tests for Quotation service layer.
 *
 * Prisma is mocked so these tests run without a live database.
 * Tests cover:
 * - Organization-scoped queries (org isolation)
 * - Soft-delete filtering
 * - Permission enforcement (401, 403)
 * - Cross-org non-disclosing 404
 * - Cross-org opportunity/contact relationship validation
 * - Server-calculated totals from line items
 * - Immutable accepted records
 * - Status transition validation
 * - Audit logging
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    quotation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    opportunity: {
      findFirst: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth-server', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

vi.mock('@/lib/services/automation/run-workflow-service', () => ({
  emitWorkflowEvent: vi.fn(async () => ({})),
  emitWorkflowEvents: vi.fn(async () => []),
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import {
  listQuotations,
  getQuotation,
  createQuotation,
  updateQuotation,
  deleteQuotation,
} from '@/lib/services/crm/quotation-service';
import type {
  QuotationCreateInput,
  QuotationUpdateInput,
  QuotationQueryInput,
  QuotationLineItemInput,
} from '@/lib/schemas/crm/quotation.schema';

const mockQuotationFindMany = prisma.quotation.findMany as unknown as ReturnType<typeof vi.fn>;
const mockQuotationFindFirst = prisma.quotation.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockQuotationCreate = prisma.quotation.create as unknown as ReturnType<typeof vi.fn>;
const mockQuotationUpdate = prisma.quotation.update as unknown as ReturnType<typeof vi.fn>;
const mockQuotationCount = prisma.quotation.count as unknown as ReturnType<typeof vi.fn>;
const mockOppFindFirst = prisma.opportunity.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockContactFindFirst = prisma.contact.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;

const orgId = 'org_123';
const userId = 'user_123';
const quotationId = 'quotation_123';

const mockSession = {
  session: { id: 'session_123', userId, expiresAt: new Date(Date.now() + 86400000) },
  user: {
    id: userId,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    organizationId: orgId,
  },
};

function mockAuth(user = mockSession.user) {
  mockGetSession.mockResolvedValue({ session: mockSession.session, user });
  mockCookies.mockReturnValue({
    toString: () => 'better-auth.session_token=test',
  });
}

function mockNoAuth() {
  mockGetSession.mockResolvedValue({ session: null, user: null });
  mockCookies.mockReturnValue({
    toString: () => '',
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth();
  mockRequireOrganization.mockResolvedValue({ organizationId: orgId });
  mockRequirePermission.mockResolvedValue(undefined);
  mockTransaction.mockImplementation((arg: unknown) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return (arg as (tx: typeof prisma) => unknown)(prisma);
  });
});

describe('Quotation service - listQuotations', () => {
  it('returns org-scoped quotations with pagination', async () => {
    mockQuotationFindMany.mockResolvedValue([
      {
        id: quotationId,
        organizationId: orgId,
        number: 'QOT-20260001',
        opportunityId: null,
        contactId: null,
        title: 'Test Quotation',
        status: 'draft',
        subtotal: '1000.00',
        tax: '100.00',
        total: '1100.00',
        currency: 'USD',
        validUntil: null,
        notes: null,
        deletedAt: null,
        createdBy: userId,
        updatedBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
      },
    ]);
    mockQuotationCount.mockResolvedValue(1);

    const result = await listQuotations({ page: 1, pageSize: 20 } as QuotationQueryInput);

    expect(mockQuotationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: orgId, deletedAt: null }),
      })
    );
    expect(result.quotations).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('filters out soft-deleted quotations by default', async () => {
    mockQuotationFindMany.mockResolvedValue([]);
    mockQuotationCount.mockResolvedValue(0);

    await listQuotations({ page: 1, pageSize: 20 } as QuotationQueryInput);

    expect(mockQuotationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(listQuotations({ page: 1, pageSize: 20 } as QuotationQueryInput)).rejects.toThrow(
      'Unauthenticated'
    );
  });

  it('throws 403 when user lacks quotation.read permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(listQuotations({ page: 1, pageSize: 20 } as QuotationQueryInput)).rejects.toThrow(
      'Forbidden'
    );
  });
});

describe('Quotation service - getQuotation', () => {
  it('returns quotation for same org', async () => {
    mockQuotationFindFirst.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      number: 'QOT-20260001',
      opportunityId: null,
      contactId: null,
      title: 'Test Quotation',
      status: 'draft',
      subtotal: '1000.00',
      tax: '100.00',
      total: '1100.00',
      currency: 'USD',
      validUntil: null,
      notes: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
      creator: null,
      updater: null,
      opportunity: null,
      contact: null,
    });

    const result = await getQuotation(quotationId);
    expect(result.id).toBe(quotationId);
    expect(mockQuotationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId, organizationId: orgId },
      })
    );
  });

  it('throws non-disclosing 404 for cross-org quotation', async () => {
    mockQuotationFindFirst.mockResolvedValue(null);

    await expect(getQuotation(quotationId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Quotation service - createQuotation', () => {
  const lineItems: QuotationLineItemInput[] = [
    {
      description: 'Design services',
      quantity: '10',
      unitPrice: '100',
      taxRate: '10',
      sortOrder: 0,
    },
  ];

  const createInput = {
    title: 'Test Quotation',
    status: 'draft',
    currency: 'USD',
    contactId: null,
    opportunityId: null,
    validUntil: null,
    notes: null,
  } as QuotationCreateInput;

  it('creates quotation with server-calculated totals and org scoping', async () => {
    mockQuotationCreate.mockResolvedValue({
      id: 'new_quotation',
      organizationId: orgId,
      number: 'QOT-20260001',
      opportunityId: null,
      contactId: null,
      title: 'Test Quotation',
      status: 'draft',
      subtotal: '1000.00',
      tax: '100.00',
      total: '1100.00',
      currency: 'USD',
      validUntil: null,
      notes: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await createQuotation(createInput, lineItems);

    expect(mockQuotationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: orgId,
          title: 'Test Quotation',
          status: 'draft',
          currency: 'USD',
          subtotal: '1000.00',
          tax: '100.00',
          total: '1100.00',
        }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
    expect(result.title).toBe('Test Quotation');
    expect(result.subtotal).toBe('1000.00');
    expect(result.total).toBe('1100.00');
  });

  it('calculates totals server-side from line items', async () => {
    mockQuotationCreate.mockResolvedValue({
      id: 'new_quotation',
      organizationId: orgId,
      number: 'QOT-20260001',
      opportunityId: null,
      contactId: null,
      title: 'Test Quotation',
      status: 'draft',
      subtotal: '2000.00',
      tax: '200.00',
      total: '2200.00',
      currency: 'USD',
      validUntil: null,
      notes: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const multiItemInput: QuotationLineItemInput[] = [
      { description: 'Item A', quantity: '2', unitPrice: '500', taxRate: '10', sortOrder: 0 },
      { description: 'Item B', quantity: '1', unitPrice: '1000', taxRate: '10', sortOrder: 1 },
    ];

    await createQuotation({ ...createInput }, multiItemInput);

    expect(mockQuotationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: '2000.00',
          tax: '200.00',
          total: '2200.00',
        }),
      })
    );
  });

  it('validates cross-org opportunity relationship', async () => {
    mockOppFindFirst.mockResolvedValue(null);

    await expect(
      createQuotation({ ...createInput, opportunityId: 'foreign_opp' }, lineItems)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates cross-org contact relationship', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(
      createQuotation({ ...createInput, contactId: 'foreign_contact' }, lineItems)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(createQuotation(createInput, lineItems)).rejects.toThrow('Unauthenticated');
  });

  it('throws 403 when user lacks quotation.create permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(createQuotation(createInput, lineItems)).rejects.toThrow('Forbidden');
  });
});

describe('Quotation service - updateQuotation', () => {
  it('updates quotation for same org', async () => {
    mockQuotationFindFirst.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      number: 'QOT-20260001',
      opportunityId: null,
      contactId: null,
      title: 'Test Quotation',
      status: 'draft',
      subtotal: '1000.00',
      tax: '100.00',
      total: '1100.00',
      currency: 'USD',
      validUntil: null,
      notes: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    });
    mockQuotationUpdate.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      title: 'Updated Quotation',
      status: 'draft',
      subtotal: '1000.00',
      tax: '100.00',
      total: '1100.00',
      currency: 'USD',
      validUntil: null,
      notes: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await updateQuotation(quotationId, {
      title: 'Updated Quotation',
    } as QuotationUpdateInput);
    expect(result.title).toBe('Updated Quotation');
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('throws non-disclosing 404 for cross-org update', async () => {
    mockQuotationFindFirst.mockResolvedValue(null);

    await expect(
      updateQuotation(quotationId, { title: 'Hacked' } as QuotationUpdateInput)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects update of accepted quotation (immutable)', async () => {
    mockQuotationFindFirst.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      status: 'accepted',
      items: [],
    });

    await expect(
      updateQuotation(quotationId, { title: 'Hacked' } as QuotationUpdateInput)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 403 when user lacks quotation.update permission', async () => {
    mockQuotationFindFirst.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      status: 'draft',
      items: [],
    });
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(
      updateQuotation(quotationId, { title: 'Updated' } as QuotationUpdateInput)
    ).rejects.toThrow('Forbidden');
  });

  it('rejects invalid status transition', async () => {
    mockQuotationFindFirst.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      status: 'accepted',
      items: [],
    });

    await expect(
      updateQuotation(quotationId, { status: 'draft' } as QuotationUpdateInput)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('Quotation service - deleteQuotation', () => {
  it('soft deletes quotation for same org', async () => {
    mockQuotationFindFirst.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      number: 'QOT-20260001',
      title: 'Test Quotation',
      status: 'draft',
      deletedAt: null,
    });
    mockQuotationUpdate.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      deletedAt: new Date(),
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await deleteQuotation(quotationId);
    expect(result.deletedAt).toBeDefined();
    expect(mockQuotationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('throws non-disclosing 404 for cross-org delete', async () => {
    mockQuotationFindFirst.mockResolvedValue(null);

    await expect(deleteQuotation(quotationId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 403 when user lacks quotation.delete permission', async () => {
    mockQuotationFindFirst.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      status: 'draft',
    });
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(deleteQuotation(quotationId)).rejects.toThrow('Forbidden');
  });

  it('refuses to delete accepted quotation', async () => {
    mockQuotationFindFirst.mockResolvedValue({
      id: quotationId,
      organizationId: orgId,
      status: 'accepted',
    });

    await expect(deleteQuotation(quotationId)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
