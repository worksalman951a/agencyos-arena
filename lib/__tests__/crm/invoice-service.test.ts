/**
 * Unit tests for the Invoice service.
 *
 * Verifies:
 * - Organization scoping on all queries
 * - Permission checks on all operations
 * - Server-calculated totals (never trust client)
 * - Status transition rules and immutability when paid
 * - Payment recording and status updates
 * - Soft delete with paid-invoice protection
 *
 * Prisma, auth, and permissions are mocked so these tests run without a live database.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    invoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    payment: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  },
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  recordPayment,
  deleteInvoice,
} from '@/lib/services/crm/invoice-service';
import { invoiceLineItemSchema } from '@/lib/schemas/crm/invoice.schema';

const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceFindFirst = prisma.invoice.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceFindMany = prisma.invoice.findMany as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceCount = prisma.invoice.count as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceCreate = prisma.invoice.create as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceUpdate = prisma.invoice.update as unknown as ReturnType<typeof vi.fn>;
const mockContactFindFirst = prisma.contact.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockPaymentCreate = prisma.payment.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

const baseInvoice = {
  id: 'inv-1',
  organizationId: 'org-1',
  number: 'INV-2026-0001',
  clientId: 'contact-1',
  title: 'Website Redesign',
  status: 'draft',
  subtotal: '100.00',
  tax: '10.00',
  total: '110.00',
  currency: 'USD',
  dueDate: new Date('2026-12-31'),
  notes: null,
  deletedAt: null,
  createdBy: 'user-1',
  updatedBy: 'user-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  creator: { id: 'user-1', name: 'Test User', email: 'user@agency.com' },
  updater: { id: 'user-1', name: 'Test User', email: 'user@agency.com' },
  client: { id: 'contact-1', firstName: 'Jane', lastName: 'Doe' },
  items: [],
  payments: [],
};

function setupAuth() {
  mockGetSession.mockResolvedValue({
    session: { id: 'session-1' },
    user: { id: 'user-1', email: 'user@agency.com' },
  });
  mockRequireOrganization.mockResolvedValue({ organizationId: 'org-1' });
  mockRequirePermission.mockResolvedValue(undefined);
  mockCookies.mockReturnValue({ toString: () => '' } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAuth();
});

describe('Money math and validation', () => {
  it('invoiceLineItemSchema validates positive quantity', () => {
    const result = invoiceLineItemSchema.safeParse({
      description: 'Design work',
      quantity: '2',
      unitPrice: '50.00',
      taxRate: '8',
    });
    expect(result.success).toBe(true);
  });

  it('invoiceLineItemSchema rejects zero quantity', () => {
    const result = invoiceLineItemSchema.safeParse({
      description: 'Design work',
      quantity: '0',
      unitPrice: '50.00',
      taxRate: '8',
    });
    expect(result.success).toBe(false);
  });

  it('invoiceLineItemSchema rejects negative unit price', () => {
    const result = invoiceLineItemSchema.safeParse({
      description: 'Design work',
      quantity: '2',
      unitPrice: '-10.00',
      taxRate: '8',
    });
    expect(result.success).toBe(false);
  });
});

describe('listInvoices', () => {
  it('requires organization and read permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );
    await expect(
      listInvoices({
        page: 1,
        pageSize: 20,
        search: undefined,
        status: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: false,
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'invoice.read');
  });

  it('queries invoices scoped to organization with soft-delete filter', async () => {
    mockInvoiceFindMany.mockResolvedValue([]);
    mockInvoiceCount.mockResolvedValue(0);
    mockTransaction.mockResolvedValue([[], 0]);

    await listInvoices({
      page: 1,
      pageSize: 20,
      search: undefined,
      status: undefined,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      includeDeleted: false,
    });

    expect(mockInvoiceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', deletedAt: null },
      })
    );
    expect(mockInvoiceCount).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null },
    });
  });
});

describe('getInvoice', () => {
  it('returns invoice with organization isolation', async () => {
    mockInvoiceFindFirst.mockResolvedValue(baseInvoice);
    const result = await getInvoice('inv-1');
    expect(result.id).toBe('inv-1');
    expect(mockInvoiceFindFirst).toHaveBeenCalledWith({
      where: { id: 'inv-1', organizationId: 'org-1' },
      include: expect.any(Object),
    });
  });

  it('returns 404 for cross-organization invoice', async () => {
    mockInvoiceFindFirst.mockResolvedValue(null);
    await expect(getInvoice('inv-cross-org')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('createInvoice', () => {
  const lineItems = [
    { description: 'Design', quantity: '2', unitPrice: '50.00', taxRate: '10' },
    { description: 'Hosting', quantity: '1', unitPrice: '30.00', taxRate: '0' },
  ];

  it('calculates totals server-side and scopes to organization', async () => {
    mockInvoiceCreate.mockResolvedValue({ ...baseInvoice, id: 'inv-new' });
    mockContactFindFirst.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1' });

    const result = await createInvoice(
      {
        clientId: 'contact-1',
        title: 'New Invoice',
        status: 'draft',
        currency: 'USD',
        dueDate: null,
        notes: null,
      },
      lineItems
    );

    expect(mockInvoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          clientId: 'contact-1',
          subtotal: '130.00',
          tax: '10.00',
          total: '140.00',
          createdBy: 'user-1',
          updatedBy: 'user-1',
        }),
      })
    );
    expect(result.id).toBe('inv-new');
  });

  it('returns a complete response when the created row omits optional relations', async () => {
    // Regression: createInvoice used to serialize relations it never included
    // (payments/client/creator/updater), so POST returned 500 with a TypeError
    // whenever a real invoice was created. The serializer must not assume that
    // optional relations were fetched.
    const withoutRelations: Record<string, unknown> = { ...baseInvoice, id: 'inv-bare' };
    delete withoutRelations.payments;
    delete withoutRelations.client;
    delete withoutRelations.creator;
    delete withoutRelations.updater;
    delete withoutRelations.items;

    mockInvoiceCreate.mockResolvedValue(withoutRelations);
    mockContactFindFirst.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1' });

    const result = await createInvoice(
      {
        clientId: 'contact-1',
        title: 'Bare Invoice',
        status: 'draft',
        currency: 'USD',
        dueDate: null,
        notes: null,
      },
      lineItems
    );

    expect(result.id).toBe('inv-bare');
    expect(result.items).toEqual([]);
    expect(result.payments).toEqual([]);
    expect(result.client).toBeNull();
    expect(result.creator).toBeNull();
    expect(result.updater).toBeNull();
  });

  it('requests the relations the response serializer needs', async () => {
    mockInvoiceCreate.mockResolvedValue({ ...baseInvoice, id: 'inv-inc' });
    mockContactFindFirst.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1' });

    await createInvoice(
      {
        clientId: 'contact-1',
        title: 'Include Check',
        status: 'draft',
        currency: 'USD',
        dueDate: null,
        notes: null,
      },
      lineItems
    );

    expect(mockInvoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          items: expect.anything(),
          payments: expect.anything(),
          client: expect.anything(),
          creator: expect.anything(),
          updater: expect.anything(),
        }),
      })
    );
  });

  it('requires create permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );
    await expect(
      createInvoice({ title: 'Test', status: 'draft', currency: 'USD' }, lineItems)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'invoice.create');
  });

  it('returns 404 for cross-organization client', async () => {
    mockContactFindFirst.mockResolvedValue(null);
    await expect(
      createInvoice(
        { clientId: 'contact-other-org', title: 'Test', status: 'draft', currency: 'USD' },
        lineItems
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('updateInvoice', () => {
  it('rejects update on paid invoice (immutable)', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, status: 'paid' });
    await expect(updateInvoice('inv-1', { title: 'Changed' }, [])).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects update on voided invoice', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, status: 'voided' });
    await expect(updateInvoice('inv-1', { title: 'Changed' }, [])).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('allows update on draft invoice', async () => {
    mockInvoiceFindFirst.mockResolvedValue(baseInvoice);
    mockInvoiceUpdate.mockResolvedValue(baseInvoice);
    const result = await updateInvoice('inv-1', { title: 'Changed' }, []);
    expect(result).toBeDefined();
    expect(mockInvoiceUpdate).toHaveBeenCalled();
  });

  it('rejects invalid status transition', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, status: 'paid' });
    await expect(updateInvoice('inv-1', { status: 'draft' }, [])).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('recordPayment', () => {
  it('records payment and marks invoice as paid when fully covered', async () => {
    const paidInvoice = { ...baseInvoice, total: '100.00', payments: [] };
    mockInvoiceFindFirst.mockResolvedValue(paidInvoice);
    mockPaymentCreate.mockResolvedValue({
      id: 'pay-1',
      invoiceId: 'inv-1',
      amount: '100.00',
      method: 'bank_transfer',
      reference: 'REF-123',
      paidAt: new Date(),
      recordedBy: 'user-1',
      createdAt: new Date(),
    });
    mockInvoiceUpdate.mockResolvedValue({ ...paidInvoice, status: 'paid' });

    const result = await recordPayment('inv-1', {
      amount: '100.00',
      method: 'bank_transfer',
      reference: 'REF-123',
      paidAt: null,
      idempotencyKey: null,
    });

    expect(result.invoiceStatus).toBe('paid');
    expect(result.payment).toBeDefined();
    expect(result.payment.amount).toBe('100.00');
    expect(result.payment.method).toBe('bank_transfer');
    expect(result.payment.reference).toBe('REF-123');
  });

  it('rejects payment on voided invoice', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, status: 'voided' });
    await expect(
      recordPayment('inv-1', {
        amount: '50.00',
        method: 'cash',
        reference: null,
        paidAt: null,
        idempotencyKey: null,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('deleteInvoice', () => {
  it('soft deletes draft invoice', async () => {
    mockInvoiceFindFirst.mockResolvedValue(baseInvoice);
    mockInvoiceUpdate.mockResolvedValue({ ...baseInvoice, deletedAt: new Date() });
    const result = await deleteInvoice('inv-1');
    expect(result.deletedAt).toBeDefined();
    expect(mockInvoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: expect.objectContaining({ deletedAt: expect.any(Date), updatedBy: 'user-1' }),
    });
  });

  it('rejects deletion of paid invoice', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, status: 'paid' });
    await expect(deleteInvoice('inv-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns 404 for cross-organization invoice', async () => {
    mockInvoiceFindFirst.mockResolvedValue(null);
    await expect(deleteInvoice('inv-cross-org')).rejects.toMatchObject({ statusCode: 404 });
  });
});
