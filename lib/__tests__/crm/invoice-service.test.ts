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
      findUniqueOrThrow: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    payment: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
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

// Document numbers are allocated inside the creation transaction; the allocator
// itself is covered by lib/__tests__/settings/document-numbering.test.ts and the
// integration suite.
vi.mock('@/lib/services/settings/document-numbering', () => ({
  allocateDocumentNumber: vi.fn(),
}));

vi.mock('@/lib/services/automation/run-workflow-service', () => ({
  emitWorkflowEvent: vi.fn(async () => ({})),
  emitWorkflowEvents: vi.fn(async () => []),
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  emitWorkflowEvent,
  emitWorkflowEvents,
} from '@/lib/services/automation/run-workflow-service';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  recordPayment,
  deleteInvoice,
} from '@/lib/services/crm/invoice-service';
import {
  invoiceCreateSchema,
  invoiceLineItemSchema,
  invoiceUpdateSchema,
} from '@/lib/schemas/crm/invoice.schema';
import { allocateDocumentNumber } from '@/lib/services/settings/document-numbering';

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
const mockPaymentFindFirst = prisma.payment.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockQueryRawUnsafe = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceFindUniqueOrThrow = prisma.invoice.findUniqueOrThrow as unknown as ReturnType<
  typeof vi.fn
>;
const mockAllocateNumber = allocateDocumentNumber as unknown as ReturnType<typeof vi.fn>;
const mockEmitWorkflowEvent = emitWorkflowEvent as unknown as ReturnType<typeof vi.fn>;
const mockEmitWorkflowEvents = emitWorkflowEvents as unknown as ReturnType<typeof vi.fn>;

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
  // Interactive transaction: run the callback against the same mocked client.
  mockTransaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as [])
  );
  // Mirrors the allocator's real contract: it reserves a sequence and returns
  // the formatted number alongside it.
  mockAllocateNumber.mockResolvedValue({ number: 'INV-2026-0001', sequence: 1, prefix: 'INV' });
  // Row lock used to serialise concurrent payments.
  mockQueryRawUnsafe.mockResolvedValue([]);
  mockPaymentFindFirst.mockResolvedValue(null);
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

  it('defaults new invoices to draft and permits only draft or sent creation states', () => {
    expect(invoiceCreateSchema.parse({ title: 'Draft' }).status).toBe('draft');
    expect(invoiceCreateSchema.parse({ title: 'Already sent', status: 'sent' }).status).toBe(
      'sent'
    );
    for (const status of ['paid', 'voided', 'overdue', 'unknown']) {
      expect(invoiceCreateSchema.safeParse({ title: 'Invalid', status }).success).toBe(false);
    }
  });

  it('accepts manual update targets and rejects payment/aging-managed statuses', () => {
    expect(invoiceUpdateSchema.safeParse({ status: 'sent' }).success).toBe(true);
    expect(invoiceUpdateSchema.safeParse({ status: 'voided' }).success).toBe(true);
    for (const status of ['paid', 'overdue', 'unknown']) {
      expect(invoiceUpdateSchema.safeParse({ status }).success).toBe(false);
    }
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
    mockInvoiceCreate.mockResolvedValue({ id: 'inv-new' });
    mockInvoiceFindUniqueOrThrow.mockResolvedValue({ ...baseInvoice, id: 'inv-new' });
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
    expect(mockEmitWorkflowEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'record.created',
      recordType: 'Invoice',
      recordId: 'inv-new',
    });

    // Numbering is delegated to the atomic allocator, inside the transaction,
    // instead of scanning for the last number (which could race).
    expect(mockAllocateNumber).toHaveBeenCalledWith(expect.anything(), 'org-1', 'invoice');
    expect(mockInvoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ number: 'INV-2026-0001' }) })
    );
    // The stored column is the formatted string, never the allocator's result
    // object (Prisma rejects an object value for `number` at runtime).
    const createArgs = mockInvoiceCreate.mock.calls[0][0] as { data: { number: unknown } };
    expect(typeof createArgs.data.number).toBe('string');
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

    mockInvoiceCreate.mockResolvedValue({ id: 'inv-bare' });
    mockInvoiceFindUniqueOrThrow.mockResolvedValue(withoutRelations);
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
    mockInvoiceCreate.mockResolvedValue({ id: 'inv-inc' });
    mockInvoiceFindUniqueOrThrow.mockResolvedValue({ ...baseInvoice, id: 'inv-inc' });
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

    // The full record (with the relations the serializer needs) is re-read after
    // the transaction commits, keyed by the id the create returned.
    expect(mockInvoiceFindUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-inc' },
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

  it('rejects non-initial statuses at the service boundary before writing', async () => {
    await expect(
      createInvoice({ title: 'Already paid', status: 'paid', currency: 'USD' } as never, lineItems)
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
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

  it('retries with a fresh number when the unique index reports a collision', async () => {
    mockInvoiceCreate.mockResolvedValue({ id: 'inv-retry' });
    mockInvoiceFindUniqueOrThrow.mockResolvedValue({ ...baseInvoice, id: 'inv-retry' });
    mockContactFindFirst.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1' });
    mockTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );

    const result = await createInvoice(
      {
        clientId: 'contact-1',
        title: 'Collision',
        status: 'draft',
        currency: 'USD',
        dueDate: null,
        notes: null,
      },
      lineItems
    );

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('inv-retry');
  });

  it('does not retry a non-unique failure', async () => {
    mockContactFindFirst.mockResolvedValue({ id: 'contact-1', organizationId: 'org-1' });
    mockTransaction.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      createInvoice(
        {
          clientId: 'contact-1',
          title: 'Fails',
          status: 'draft',
          currency: 'USD',
          dueDate: null,
          notes: null,
        },
        lineItems
      )
    ).rejects.toThrow('connection lost');
    expect(mockTransaction).toHaveBeenCalledTimes(1);
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

  it('allows a draft invoice to transition to sent', async () => {
    mockInvoiceFindFirst.mockResolvedValue(baseInvoice);
    mockInvoiceUpdate.mockResolvedValue({ ...baseInvoice, status: 'sent' });

    const result = await updateInvoice('inv-1', { status: 'sent' }, []);

    expect(result.status).toBe('sent');
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'sent' }) })
    );
  });

  it('allows a sent invoice to transition to voided', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, status: 'sent' });
    mockInvoiceUpdate.mockResolvedValue({ ...baseInvoice, status: 'voided' });

    const result = await updateInvoice('inv-1', { status: 'voided' }, []);

    expect(result.status).toBe('voided');
  });

  it('rejects reverting a sent invoice to draft', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, status: 'sent' });
    await expect(updateInvoice('inv-1', { status: 'draft' }, [])).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it('rejects manual paid/overdue transitions before reading or writing invoices', async () => {
    for (const status of ['paid', 'overdue']) {
      await expect(updateInvoice('inv-1', { status } as never, [])).rejects.toMatchObject({
        statusCode: 400,
      });
    }

    expect(mockInvoiceFindFirst).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid status transition', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, status: 'paid' });
    await expect(updateInvoice('inv-1', { status: 'draft' }, [])).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects an unknown status at the service boundary without writing', async () => {
    mockInvoiceFindFirst.mockResolvedValue(baseInvoice);
    await expect(updateInvoice('inv-1', { status: 'corrupt' as never }, [])).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it('does not update an invoice belonging to another organization', async () => {
    mockInvoiceFindFirst.mockResolvedValue(null);
    await expect(updateInvoice('inv-other-org', { title: 'Tampered' }, [])).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-other-org', organizationId: 'org-1' } })
    );
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
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
    expect(result).not.toHaveProperty('previousInvoiceStatus');
    expect(result.payment).toBeDefined();
    expect(result.payment.amount).toBe('100.00');
    expect(result.payment.method).toBe('bank_transfer');
    expect(result.payment.reference).toBe('REF-123');
    expect(mockEmitWorkflowEvents).toHaveBeenCalledExactlyOnceWith([
      { type: 'record.updated', recordType: 'Invoice', recordId: 'inv-1' },
      {
        type: 'record.status_changed',
        recordType: 'Invoice',
        recordId: 'inv-1',
        previousStatus: 'draft',
      },
    ]);
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

  it('accumulates earlier partial payments before deciding the status', async () => {
    mockInvoiceFindFirst.mockResolvedValue({
      ...baseInvoice,
      status: 'sent',
      total: '100.00',
      payments: [{ id: 'pay-0', invoiceId: 'inv-1', amount: '40.00' }],
    });
    mockPaymentCreate.mockResolvedValue({
      id: 'pay-2',
      invoiceId: 'inv-1',
      amount: '60.00',
      method: 'card',
      reference: null,
      paidAt: new Date(),
      recordedBy: 'user-1',
      createdAt: new Date(),
    });
    mockInvoiceUpdate.mockResolvedValue({ ...baseInvoice, status: 'paid' });

    const result = await recordPayment('inv-1', {
      amount: '60.00',
      method: 'card',
      reference: null,
      paidAt: null,
      idempotencyKey: null,
    });

    expect(result.invoiceStatus).toBe('paid');
    expect(result.amountPaid).toBe('100.00');
    expect(result.balance).toBe('0.00');
    expect(mockInvoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: 'paid', updatedBy: 'user-1' },
    });
  });

  it('keeps an overdue invoice overdue while it is only partly paid', async () => {
    mockInvoiceFindFirst.mockResolvedValue({
      ...baseInvoice,
      status: 'overdue',
      total: '100.00',
      payments: [],
    });
    mockPaymentCreate.mockResolvedValue({
      id: 'pay-3',
      invoiceId: 'inv-1',
      amount: '25.00',
      method: 'cash',
      reference: null,
      paidAt: new Date(),
      recordedBy: 'user-1',
      createdAt: new Date(),
    });
    mockInvoiceUpdate.mockResolvedValue({ ...baseInvoice, status: 'overdue' });

    const result = await recordPayment('inv-1', {
      amount: '25.00',
      method: 'cash',
      reference: null,
      paidAt: null,
      idempotencyKey: null,
    });

    expect(result.invoiceStatus).toBe('overdue');
    expect(result.balance).toBe('75.00');
  });

  it('rejects an overpayment without recording a payment', async () => {
    mockInvoiceFindFirst.mockResolvedValue({
      ...baseInvoice,
      status: 'sent',
      total: '100.00',
      payments: [{ id: 'pay-0', invoiceId: 'inv-1', amount: '80.00' }],
    });

    await expect(
      recordPayment('inv-1', {
        amount: '30.00',
        method: 'cash',
        reference: null,
        paidAt: null,
        idempotencyKey: null,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/outstanding balance/i),
    });

    expect(mockPaymentCreate).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it('rejects a payment on an invoice with no total', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, total: '0.00', payments: [] });

    await expect(
      recordPayment('inv-1', {
        amount: '10.00',
        method: 'cash',
        reference: null,
        paidAt: null,
        idempotencyKey: null,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('replays an idempotency key instead of recording a duplicate', async () => {
    mockInvoiceFindFirst.mockResolvedValue({
      ...baseInvoice,
      status: 'sent',
      total: '100.00',
      payments: [{ id: 'pay-1', invoiceId: 'inv-1', amount: '20.00' }],
    });
    mockPaymentFindFirst.mockResolvedValue({
      id: 'pay-1',
      invoiceId: 'inv-1',
      amount: '20.00',
      method: 'bank_transfer',
      reference: null,
      paidAt: new Date(),
      recordedBy: 'user-1',
      createdAt: new Date(),
    });

    const result = await recordPayment('inv-1', {
      amount: '20.00',
      method: 'bank_transfer',
      reference: null,
      paidAt: null,
      idempotencyKey: 'key-1',
    });

    expect(result.duplicate).toBe(true);
    expect(result.payment.id).toBe('pay-1');
    expect(result.balance).toBe('80.00');
    expect(mockPaymentCreate).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
    expect(mockEmitWorkflowEvents).not.toHaveBeenCalled();
  });

  it('treats a soft-deleted invoice as missing', async () => {
    mockInvoiceFindFirst.mockResolvedValue(null);

    await expect(
      recordPayment('inv-1', {
        amount: '10.00',
        method: 'cash',
        reference: null,
        paidAt: null,
        idempotencyKey: null,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('normalises a blank idempotency key to NULL so it stays keyless', async () => {
    mockInvoiceFindFirst.mockResolvedValue({
      ...baseInvoice,
      status: 'sent',
      total: '100.00',
      payments: [],
    });
    mockPaymentCreate.mockResolvedValue({
      id: 'pay-blank',
      invoiceId: 'inv-1',
      amount: '10.00',
      method: 'cash',
      reference: null,
      paidAt: new Date(),
      recordedBy: 'user-1',
      createdAt: new Date(),
    });
    mockInvoiceUpdate.mockResolvedValue({ ...baseInvoice, status: 'sent' });

    const result = await recordPayment('inv-1', {
      amount: '10.00',
      method: 'cash',
      reference: null,
      paidAt: null,
      idempotencyKey: '   ',
    });

    expect(mockPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ idempotencyKey: null }),
    });
    expect(mockPaymentFindFirst).not.toHaveBeenCalled();
    expect(result.duplicate).toBe(false);
  });

  it('replays the winning payment when the unique index rejects a concurrent duplicate', async () => {
    // Both requests passed the in-transaction check; the loser hits the partial
    // unique index on (invoiceId, idempotencyKey).
    mockTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );
    const stored = {
      id: 'pay-winner',
      invoiceId: 'inv-1',
      amount: '25.00',
      method: 'bank_transfer',
      reference: 'REF-1',
      paidAt: new Date(),
      recordedBy: 'user-1',
      createdAt: new Date(),
      idempotencyKey: 'race-key',
    };
    mockInvoiceFindFirst.mockResolvedValue({
      ...baseInvoice,
      status: 'sent',
      total: '100.00',
      payments: [stored],
    });

    const result = await recordPayment('inv-1', {
      amount: '25.00',
      method: 'bank_transfer',
      reference: 'REF-1',
      paidAt: null,
      idempotencyKey: 'race-key',
    });

    expect(result.duplicate).toBe(true);
    expect(result.payment.id).toBe('pay-winner');
    expect(result.amountPaid).toBe('25.00');
    expect(result.balance).toBe('75.00');
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('rethrows a unique violation that is not a replayable idempotency key', async () => {
    mockTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );

    await expect(
      recordPayment('inv-1', {
        amount: '10.00',
        method: 'cash',
        reference: null,
        paidAt: null,
        idempotencyKey: null,
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects an invalid payment date', async () => {
    await expect(
      recordPayment('inv-1', {
        amount: '10.00',
        method: 'cash',
        reference: null,
        paidAt: 'not-a-date',
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
