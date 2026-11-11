/**
 * Unit tests for estimate → invoice conversion.
 *
 * Regression cover for the defect where the invoice was created without a
 * `number` (a required column) *after* the estimate had been marked
 * `converted`: every conversion failed with a 500 and stranded the estimate.
 */

vi.mock('@/lib/services/automation/run-workflow-service', () => ({
  emitWorkflowEvent: vi.fn(async () => ({})),
  emitWorkflowEvents: vi.fn(async () => []),
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    estimate: { findFirst: vi.fn(), update: vi.fn() },
    invoice: { create: vi.fn() },
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
import {
  emitWorkflowEvent,
  emitWorkflowEvents,
} from '@/lib/services/automation/run-workflow-service';
import { allocateDocumentNumber } from '@/lib/services/settings/document-numbering';
import { convertEstimateToInvoice } from '@/lib/services/crm/estimate-service';

const mockEstimateFindFirst = prisma.estimate.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockEstimateUpdate = prisma.estimate.update as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceCreate = prisma.invoice.create as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockQueryRaw = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockAllocateNumber = allocateDocumentNumber as unknown as ReturnType<typeof vi.fn>;
const mockEmitWorkflowEvent = emitWorkflowEvent as unknown as ReturnType<typeof vi.fn>;
const mockEmitWorkflowEvents = emitWorkflowEvents as unknown as ReturnType<typeof vi.fn>;

const estimate = {
  id: 'est-1',
  organizationId: 'org-1',
  number: 'EST-2026-0001',
  clientId: 'contact-1',
  status: 'accepted',
  total: '250.00',
  currency: 'EUR',
  validUntil: null,
  notes: 'Scope agreed',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const input = { invoiceTitle: 'Converted estimate', dueDate: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockResolvedValue({ toString: () => 'session=abc' });
  mockGetSession.mockResolvedValue({
    session: { id: 's1' },
    user: { id: 'user-1', email: 'user@example.com' },
  });
  mockRequireOrganization.mockResolvedValue({ organizationId: 'org-1' });
  mockRequirePermission.mockResolvedValue(undefined);
  mockTransaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as [])
  );
  mockQueryRaw.mockResolvedValue([]);
  mockAllocateNumber.mockResolvedValue({ number: 'INV-2026-0007', sequence: 7, prefix: 'INV' });
  mockEstimateFindFirst.mockResolvedValue(estimate);
  mockEstimateUpdate.mockResolvedValue({ ...estimate, status: 'converted' });
  mockInvoiceCreate.mockResolvedValue({ id: 'inv-9', number: 'INV-2026-0007' });
  mockAuditLogCreate.mockResolvedValue({ id: 'audit-1' });
});

describe('convertEstimateToInvoice', () => {
  it('allocates the invoice number, carries the totals and marks the estimate converted', async () => {
    const result = await convertEstimateToInvoice('est-1', input);

    expect(result).toEqual({
      estimateId: 'est-1',
      invoiceId: 'inv-9',
      invoiceNumber: 'INV-2026-0007',
    });

    expect(mockAllocateNumber).toHaveBeenCalledWith(expect.anything(), 'org-1', 'invoice');
    expect(mockInvoiceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        number: 'INV-2026-0007',
        clientId: 'contact-1',
        status: 'draft',
        currency: 'EUR',
        subtotal: '250.00',
        tax: 0,
        total: '250.00',
        notes: 'Scope agreed',
      }),
    });
    // The number is the allocator's, never a caller-supplied one.
    expect(mockInvoiceCreate.mock.calls[0][0].data.number).toBe('INV-2026-0007');
    expect(mockEstimateUpdate).toHaveBeenCalledWith({
      where: { id: 'est-1' },
      data: { status: 'converted' },
    });
    expect(mockEmitWorkflowEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'record.created',
      recordType: 'Invoice',
      recordId: 'inv-9',
    });
    expect(mockEmitWorkflowEvents).toHaveBeenCalledExactlyOnceWith([
      { type: 'record.updated', recordType: 'Estimate', recordId: 'est-1' },
      {
        type: 'record.status_changed',
        recordType: 'Estimate',
        recordId: 'est-1',
        previousStatus: 'accepted',
      },
    ]);
  });

  it('rejects an estimate that is not accepted without touching it', async () => {
    mockEstimateFindFirst.mockResolvedValue({ ...estimate, status: 'draft' });

    await expect(convertEstimateToInvoice('est-1', input)).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(mockInvoiceCreate).not.toHaveBeenCalled();
    expect(mockEstimateUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 for an estimate in another organization', async () => {
    mockEstimateFindFirst.mockResolvedValue(null);

    await expect(convertEstimateToInvoice('est-x', input)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
  });

  it('leaves the estimate convertible when the invoice cannot be created', async () => {
    mockInvoiceCreate.mockRejectedValue(new Error('insert failed'));

    await expect(convertEstimateToInvoice('est-1', input)).rejects.toThrow('insert failed');
    expect(mockEstimateUpdate).not.toHaveBeenCalled();
  });

  it('rejects an invalid due date before starting the transaction', async () => {
    await expect(
      convertEstimateToInvoice('est-1', { ...input, dueDate: 'not-a-date' })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
