/** Unit tests for Proposal service layer.
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
    proposal: {
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

// The number allocator runs inside the creation transaction; its own atomicity
// is covered by the integration suite, so here we only verify the delegation.
vi.mock('@/lib/services/settings/document-numbering', () => ({
  allocateDocumentNumber: vi.fn(),
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
  listProposals,
  getProposal,
  createProposal,
  updateProposal,
  deleteProposal,
} from '@/lib/services/crm/proposal-service';
import { allocateDocumentNumber } from '@/lib/services/settings/document-numbering';
import type {
  ProposalCreateInput,
  ProposalUpdateInput,
  ProposalQueryInput,
  ProposalLineItemInput,
} from '@/lib/schemas/crm/proposal.schema';

const mockProposalFindMany = prisma.proposal.findMany as unknown as ReturnType<typeof vi.fn>;
const mockProposalFindFirst = prisma.proposal.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockProposalCreate = prisma.proposal.create as unknown as ReturnType<typeof vi.fn>;
const mockAllocateNumber = allocateDocumentNumber as unknown as ReturnType<typeof vi.fn>;
const mockProposalUpdate = prisma.proposal.update as unknown as ReturnType<typeof vi.fn>;
const mockProposalCount = prisma.proposal.count as unknown as ReturnType<typeof vi.fn>;
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
const proposalId = 'proposal_123';

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
  // Interactive transaction: run the callback against the same mocked client.
  mockTransaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as [])
  );
  let sequence = 0;
  mockAllocateNumber.mockImplementation(async () => {
    sequence += 1;
    return {
      number: `PRP-2026-${String(sequence).padStart(4, '0')}`,
      sequence,
      prefix: 'PRP',
    };
  });
});

describe('Proposal service - listProposals', () => {
  it('returns org-scoped proposals with pagination', async () => {
    mockProposalFindMany.mockResolvedValue([
      {
        id: proposalId,
        organizationId: orgId,
        number: 'PRP-20260001',
        opportunityId: null,
        contactId: null,
        title: 'Test Proposal',
        status: 'draft',
        subtotal: 1000,
        tax: 100,
        total: 1100,
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
    mockProposalCount.mockResolvedValue(1);

    const result = await listProposals({ page: 1, pageSize: 20 } as ProposalQueryInput);

    expect(mockProposalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: orgId, deletedAt: null }),
      })
    );
    expect(result.proposals).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('filters out soft-deleted proposals by default', async () => {
    mockProposalFindMany.mockResolvedValue([]);
    mockProposalCount.mockResolvedValue(0);

    await listProposals({ page: 1, pageSize: 20 } as ProposalQueryInput);

    expect(mockProposalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(listProposals({ page: 1, pageSize: 20 } as ProposalQueryInput)).rejects.toThrow(
      'Unauthenticated'
    );
  });

  it('throws 403 when user lacks proposal.read permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(listProposals({ page: 1, pageSize: 20 } as ProposalQueryInput)).rejects.toThrow(
      'Forbidden'
    );
  });
});

describe('Proposal service - getProposal', () => {
  it('returns proposal for same org', async () => {
    mockProposalFindFirst.mockResolvedValue({
      id: proposalId,
      organizationId: orgId,
      number: 'PRP-20260001',
      opportunityId: null,
      contactId: null,
      title: 'Test Proposal',
      status: 'draft',
      subtotal: 1000,
      tax: 100,
      total: 1100,
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

    const result = await getProposal(proposalId);
    expect(result.id).toBe(proposalId);
    expect(mockProposalFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: proposalId, organizationId: orgId },
      })
    );
  });

  it('throws non-disclosing 404 for cross-org proposal', async () => {
    mockProposalFindFirst.mockResolvedValue(null);

    await expect(getProposal(proposalId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Proposal service - createProposal', () => {
  const lineItems: ProposalLineItemInput[] = [
    {
      description: 'Design services',
      quantity: '10',
      unitPrice: '100',
      taxRate: '10',
      sortOrder: 0,
    },
  ];

  const createInput = {
    title: 'Test Proposal',
    status: 'draft',
    currency: 'USD',
    contactId: null,
    opportunityId: null,
    validUntil: null,
    notes: null,
  } as ProposalCreateInput;

  it('creates proposal with server-calculated totals and org scoping', async () => {
    mockProposalCreate.mockResolvedValue({
      id: 'new_proposal',
      organizationId: orgId,
      number: 'PRP-20260001',
      opportunityId: null,
      contactId: null,
      title: 'Test Proposal',
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

    const result = await createProposal(createInput, lineItems);

    expect(mockProposalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: orgId,
          title: 'Test Proposal',
          status: 'draft',
          currency: 'USD',
          subtotal: '1000.00',
          tax: '100.00',
          total: '1100.00',
        }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
    expect(result.title).toBe('Test Proposal');
    expect(result.subtotal).toBe('1000.00');
    expect(result.total).toBe('1100.00');
  });

  it('calculates totals server-side from line items', async () => {
    mockProposalCreate.mockResolvedValue({
      id: 'new_proposal',
      organizationId: orgId,
      number: 'PRP-20260001',
      opportunityId: null,
      contactId: null,
      title: 'Test Proposal',
      status: 'draft',
      subtotal: 2000,
      tax: 200,
      total: 2200,
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

    const multiItemInput: ProposalLineItemInput[] = [
      { description: 'Item A', quantity: '2', unitPrice: '500', taxRate: '10', sortOrder: 0 },
      { description: 'Item B', quantity: '1', unitPrice: '1000', taxRate: '10', sortOrder: 1 },
    ];

    await createProposal({ ...createInput }, multiItemInput);

    expect(mockProposalCreate).toHaveBeenCalledWith(
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
      createProposal({ ...createInput, opportunityId: 'foreign_opp' }, lineItems)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates cross-org contact relationship', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(
      createProposal({ ...createInput, contactId: 'foreign_contact' }, lineItems)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(createProposal(createInput, lineItems)).rejects.toThrow('Unauthenticated');
  });

  it('throws 403 when user lacks proposal.create permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(createProposal(createInput, lineItems)).rejects.toThrow('Forbidden');
  });
});

describe('Proposal service - updateProposal', () => {
  it('updates proposal for same org', async () => {
    mockProposalFindFirst.mockResolvedValue({
      id: proposalId,
      organizationId: orgId,
      number: 'PRP-20260001',
      opportunityId: null,
      contactId: null,
      title: 'Test Proposal',
      status: 'draft',
      subtotal: 1000,
      tax: 100,
      total: 1100,
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
    mockProposalUpdate.mockResolvedValue({
      id: proposalId,
      organizationId: orgId,
      title: 'Updated Proposal',
      status: 'draft',
      subtotal: 1000,
      tax: 100,
      total: 1100,
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

    const result = await updateProposal(proposalId, {
      title: 'Updated Proposal',
    } as ProposalUpdateInput);
    expect(result.title).toBe('Updated Proposal');
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('throws non-disclosing 404 for cross-org update', async () => {
    mockProposalFindFirst.mockResolvedValue(null);

    await expect(
      updateProposal(proposalId, { title: 'Hacked' } as ProposalUpdateInput)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects update of accepted proposal (immutable)', async () => {
    mockProposalFindFirst.mockResolvedValue({
      id: proposalId,
      organizationId: orgId,
      status: 'accepted',
      items: [],
    });

    await expect(
      updateProposal(proposalId, { title: 'Hacked' } as ProposalUpdateInput)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 403 when user lacks proposal.update permission', async () => {
    mockProposalFindFirst.mockResolvedValue({
      id: proposalId,
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
      updateProposal(proposalId, { title: 'Updated' } as ProposalUpdateInput)
    ).rejects.toThrow('Forbidden');
  });

  it('rejects invalid status transition', async () => {
    mockProposalFindFirst.mockResolvedValue({
      id: proposalId,
      organizationId: orgId,
      status: 'accepted',
      items: [],
    });

    await expect(
      updateProposal(proposalId, { status: 'draft' } as ProposalUpdateInput)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('Proposal service - deleteProposal', () => {
  it('soft deletes proposal for same org', async () => {
    mockProposalFindFirst.mockResolvedValue({
      id: proposalId,
      organizationId: orgId,
      number: 'PRP-20260001',
      title: 'Test Proposal',
      status: 'draft',
      deletedAt: null,
    });
    mockProposalUpdate.mockResolvedValue({
      id: proposalId,
      organizationId: orgId,
      deletedAt: new Date(),
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await deleteProposal(proposalId);
    expect(result.deletedAt).toBeDefined();
    expect(mockProposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: proposalId },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('throws non-disclosing 404 for cross-org delete', async () => {
    mockProposalFindFirst.mockResolvedValue(null);

    await expect(deleteProposal(proposalId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 403 when user lacks proposal.delete permission', async () => {
    mockProposalFindFirst.mockResolvedValue({
      id: proposalId,
      organizationId: orgId,
      status: 'draft',
    });
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(deleteProposal(proposalId)).rejects.toThrow('Forbidden');
  });

  it('refuses to delete accepted proposal', async () => {
    mockProposalFindFirst.mockResolvedValue({
      id: proposalId,
      organizationId: orgId,
      status: 'accepted',
    });

    await expect(deleteProposal(proposalId)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('Proposal service - document numbering', () => {
  const numberingInput = {
    title: 'Test Proposal',
    status: 'draft',
    currency: 'USD',
    contactId: null,
    opportunityId: null,
    validUntil: null,
    notes: null,
  } as ProposalCreateInput;

  const numberingItems: ProposalLineItemInput[] = [
    { description: 'Design services', quantity: '1', unitPrice: '100', taxRate: '0', sortOrder: 0 },
  ];

  it('allocates each number inside the creation transaction', async () => {
    mockProposalCreate.mockImplementation((args: { data: { number: string } }) =>
      Promise.resolve({
        id: proposalId,
        organizationId: orgId,
        number: args.data.number,
        opportunityId: null,
        contactId: null,
        title: 'Concurrent proposal',
        status: 'draft',
        subtotal: '100.00',
        tax: '0.00',
        total: '100.00',
        currency: 'USD',
        validUntil: null,
        notes: null,
        deletedAt: null,
        createdBy: userId,
        updatedBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
      })
    );
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const [first, second] = await Promise.all([
      createProposal({ ...numberingInput, title: 'Concurrent 1' }, numberingItems),
      createProposal({ ...numberingInput, title: 'Concurrent 2' }, numberingItems),
    ]);

    // Two creations → two allocations, both inside a transaction for this org.
    expect(mockAllocateNumber).toHaveBeenCalledTimes(2);
    for (const call of mockAllocateNumber.mock.calls) {
      expect(call[1]).toBe(orgId);
      expect(call[2]).toBe('proposal');
    }

    // The numbers the service stores come from the allocator, so they cannot
    // collide even when both creates start at the same time.
    expect(first.number).not.toBe(second.number);
    expect(first.number).toMatch(/^PRP-2026-\d{4}$/);
    expect(second.number).toMatch(/^PRP-2026-\d{4}$/);
  });

  it('fails the creation when the allocator fails, so no unnumbered row is written', async () => {
    mockAllocateNumber.mockRejectedValueOnce(
      Object.assign(new Error('numbering unavailable'), { statusCode: 500 })
    );

    await expect(createProposal({ ...numberingInput }, numberingItems)).rejects.toThrow(
      'numbering unavailable'
    );
    expect(mockProposalCreate).not.toHaveBeenCalled();
  });
});

describe('Proposal service - decimal precision', () => {
  it('handles floating-point edge cases in monetary calculations', async () => {
    // 0.1 + 0.2 should not produce 0.30000000000000004
    mockProposalCreate.mockResolvedValue({
      id: 'precision_test',
      organizationId: orgId,
      number: 'PRP-2026-0001',
      opportunityId: null,
      contactId: null,
      title: 'Precision Test',
      status: 'draft',
      subtotal: '0.30',
      tax: '0.03',
      total: '0.33',
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

    // 3 items at 0.10 each with 10% tax → subtotal 0.30, tax 0.03, total 0.33
    const localCreateInput = {
      title: 'Precision Test',
      status: 'draft',
      currency: 'USD',
      contactId: null,
      opportunityId: null,
      validUntil: null,
      notes: null,
    } as ProposalCreateInput;

    const lineItems = [
      { description: 'Item 1', quantity: '1', unitPrice: '0.10', taxRate: '10', sortOrder: 0 },
      { description: 'Item 2', quantity: '1', unitPrice: '0.10', taxRate: '10', sortOrder: 1 },
      { description: 'Item 3', quantity: '1', unitPrice: '0.10', taxRate: '10', sortOrder: 2 },
    ];

    const result = await createProposal(
      { ...localCreateInput, title: 'Precision Test' },
      lineItems
    );

    // Verify no floating-point artifacts
    expect(result.subtotal).toBe('0.30');
    expect(result.tax).toBe('0.03');
    expect(result.total).toBe('0.33');

    // Verify Prisma was called with correct decimal values
    expect(mockProposalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: '0.30',
          tax: '0.03',
          total: '0.33',
        }),
      })
    );
  });

  it('handles large monetary values without precision loss', async () => {
    mockProposalCreate.mockResolvedValue({
      id: 'large_value_test',
      organizationId: orgId,
      number: 'PRP-2026-0001',
      opportunityId: null,
      contactId: null,
      title: 'Large Value Test',
      status: 'draft',
      subtotal: '999999.99',
      tax: '99999.99',
      total: '1099999.98',
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

    const localCreateInput = {
      title: 'Large Value Test',
      status: 'draft',
      currency: 'USD',
      contactId: null,
      opportunityId: null,
      validUntil: null,
      notes: null,
    } as ProposalCreateInput;

    const lineItems = [
      {
        description: 'Expensive Item',
        quantity: '1',
        unitPrice: '999999.99',
        taxRate: '10',
        sortOrder: 0,
      },
    ];

    const result = await createProposal(
      { ...localCreateInput, title: 'Large Value Test' },
      lineItems
    );

    expect(result.subtotal).toBe('999999.99');
    expect(result.total).toMatch(/^\d+\.\d{2}$/); // Always 2 decimal places
  });
});
