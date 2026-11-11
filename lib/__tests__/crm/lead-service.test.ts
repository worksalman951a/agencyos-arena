/** Unit tests for Lead service layer.
 *
 * Prisma is mocked so these tests run without a live database.
 * Tests cover:
 * - Organization-scoped queries (org isolation)
 * - Soft-delete filtering
 * - Permission enforcement (401, 403)
 * - Cross-org non-disclosing 404
 * - Duplicate detection and override
 * - Owner membership validation (lead.assign)
 * - Cross-org contact/account relationship validation
 * - Audit logging with sensitive values redacted
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    agencyAccount: {
      findFirst: vi.fn(),
    },
    pipeline: {
      findFirst: vi.fn(),
    },
    pipelineStage: {
      findFirst: vi.fn(),
    },
    userRole: {
      findFirst: vi.fn(),
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
  listLeads,
  getLead,
  checkDuplicate,
  createLead,
  updateLead,
  deleteLead,
} from '@/lib/services/crm/lead-service';
import type {
  LeadCreateInput,
  LeadUpdateInput,
  LeadQueryInput,
} from '@/lib/schemas/crm/lead.schema';

const mockLeadFindMany = prisma.lead.findMany as unknown as ReturnType<typeof vi.fn>;
const mockLeadFindFirst = prisma.lead.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockLeadCreate = prisma.lead.create as unknown as ReturnType<typeof vi.fn>;
const mockLeadUpdate = prisma.lead.update as unknown as ReturnType<typeof vi.fn>;
const mockLeadCount = prisma.lead.count as unknown as ReturnType<typeof vi.fn>;
const mockContactFindFirst = prisma.contact.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAccountFindFirst = prisma.agencyAccount.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockPipelineFindFirst = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockPipelineStageFindFirst = prisma.pipelineStage.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockUserRoleFindFirst = prisma.userRole.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;

const orgId = 'org_123';
const userId = 'user_123';
const leadId = 'lead_123';

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
  mockTransaction.mockImplementation(([findManyPromise, countPromise]) =>
    Promise.all([findManyPromise, countPromise])
  );
});

describe('Lead service - listLeads', () => {
  it('returns org-scoped leads with pagination', async () => {
    mockLeadFindMany.mockResolvedValue([
      {
        id: leadId,
        organizationId: orgId,
        contactId: null,
        accountId: null,
        source: 'website',
        status: 'new',
        priority: 'high',
        expectedValue: 5000,
        ownerId: null,
        pipelineId: null,
        stageId: null,
        notes: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        contact: null,
        account: null,
        owner: null,
        pipeline: null,
        stage: null,
      },
    ]);
    mockLeadCount.mockResolvedValue(1);

    const result = await listLeads({ page: 1, pageSize: 20 } as LeadQueryInput);

    expect(mockLeadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: orgId, deletedAt: null }),
      })
    );
    expect(result.leads).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('filters out soft-deleted leads by default', async () => {
    mockLeadFindMany.mockResolvedValue([]);
    mockLeadCount.mockResolvedValue(0);

    await listLeads({ page: 1, pageSize: 20 } as LeadQueryInput);

    expect(mockLeadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it('includes soft-deleted leads when includeDeleted is true', async () => {
    mockLeadFindMany.mockResolvedValue([]);
    mockLeadCount.mockResolvedValue(0);

    await listLeads({ page: 1, pageSize: 20, includeDeleted: true } as LeadQueryInput);

    const whereArg = mockLeadFindMany.mock.calls[0][0].where;
    expect(whereArg.deletedAt).toBeUndefined();
  });

  it('filters by status and priority', async () => {
    mockLeadFindMany.mockResolvedValue([]);
    mockLeadCount.mockResolvedValue(0);

    await listLeads({
      page: 1,
      pageSize: 20,
      status: 'qualified',
      priority: 'high',
    } as LeadQueryInput);

    const whereArg = mockLeadFindMany.mock.calls[0][0].where;
    expect(whereArg.status).toBe('qualified');
    expect(whereArg.priority).toBe('high');
  });

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(listLeads({ page: 1, pageSize: 20 } as LeadQueryInput)).rejects.toThrow(
      'Unauthenticated'
    );
  });

  it('throws 403 when user lacks lead.read permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(listLeads({ page: 1, pageSize: 20 } as LeadQueryInput)).rejects.toThrow(
      'Forbidden'
    );
  });
});

describe('Lead service - getLead', () => {
  it('returns lead for same org', async () => {
    mockLeadFindFirst.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      source: 'website',
      status: 'new',
      priority: 'high',
      expectedValue: 5000,
      ownerId: null,
      pipelineId: null,
      stageId: null,
      notes: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      contact: null,
      account: null,
      owner: null,
      pipeline: null,
      stage: null,
    });

    const result = await getLead(leadId);
    expect(result.id).toBe(leadId);
    expect(mockLeadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: leadId, organizationId: orgId },
      })
    );
  });

  it('throws non-disclosing 404 for cross-org lead', async () => {
    mockLeadFindFirst.mockResolvedValue(null);

    await expect(getLead(leadId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Lead service - checkDuplicate', () => {
  it('returns no duplicate when no matching lead exists', async () => {
    mockLeadFindFirst.mockResolvedValue(null);

    const result = await checkDuplicate({
      contactId: null,
      accountId: null,
      source: 'website',
      status: 'new',
    } as LeadCreateInput);

    expect(result.isDuplicate).toBe(false);
    expect(result.duplicateId).toBeNull();
    // With only source + status (no contact/account), findFirst should not be called
    expect(mockLeadFindFirst).not.toHaveBeenCalled();
  });

  it('does NOT flag unrelated leads as duplicates when only source + status match', async () => {
    // source + status alone are not reliable duplicate identifiers
    mockLeadFindFirst.mockResolvedValue({
      id: 'existing_lead',
      organizationId: orgId,
    });

    const result = await checkDuplicate({
      contactId: null,
      accountId: null,
      source: 'website',
      status: 'new',
    } as LeadCreateInput);

    expect(result.isDuplicate).toBe(false);
    expect(result.duplicateId).toBeNull();
    // findFirst should not be called without reliable identifiers
    expect(mockLeadFindFirst).not.toHaveBeenCalled();
  });

  it('returns duplicate when contactId + source + status match', async () => {
    mockLeadFindFirst.mockResolvedValue({
      id: 'existing_lead',
      organizationId: orgId,
    });

    const result = await checkDuplicate({
      contactId: 'contact_1',
      source: 'website',
      status: 'new',
    } as LeadCreateInput);

    expect(result.isDuplicate).toBe(true);
    expect(result.duplicateId).toBe('existing_lead');
    expect(mockLeadFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: orgId,
        deletedAt: null,
        contactId: 'contact_1',
        source: 'website',
        status: 'new',
      },
    });
  });

  it('returns duplicate when accountId + source + status match', async () => {
    mockLeadFindFirst.mockResolvedValue({
      id: 'existing_lead',
      organizationId: orgId,
    });

    const result = await checkDuplicate({
      accountId: 'account_1',
      source: 'website',
      status: 'new',
    } as LeadCreateInput);

    expect(result.isDuplicate).toBe(true);
    expect(result.duplicateId).toBe('existing_lead');
    expect(mockLeadFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: orgId,
        deletedAt: null,
        accountId: 'account_1',
        source: 'website',
        status: 'new',
      },
    });
  });

  it('returns no duplicate when multiple independent leads share source + status', async () => {
    // Simulating multiple independent leads without contact/account all having
    // source='website' and status='new' — none should be flagged as duplicates.
    mockLeadFindFirst.mockResolvedValue(null);

    const leads = [
      { contactId: null, accountId: null, source: 'website', status: 'new' },
      { contactId: null, accountId: null, source: 'website', status: 'new' },
      { contactId: null, accountId: null, source: 'website', status: 'new' },
    ] as LeadCreateInput[];

    for (const lead of leads) {
      const result = await checkDuplicate(lead);
      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateId).toBeNull();
    }

    // findFirst should never be called for any of these leads
    expect(mockLeadFindFirst).not.toHaveBeenCalled();
  });
});

describe('Lead service - createLead', () => {
  const createInput = {
    source: 'website',
    status: 'new',
    priority: 'high',
    expectedValue: '5000.00',
    contactId: null,
    accountId: null,
    ownerId: null,
    pipelineId: null,
    stageId: null,
    notes: null,
  } as LeadCreateInput;

  it('creates lead with organization scoping and audit logging', async () => {
    mockLeadCreate.mockResolvedValue({
      id: 'new_lead',
      organizationId: orgId,
      contactId: null,
      accountId: null,
      source: 'website',
      status: 'new',
      priority: 'high',
      expectedValue: 5000,
      ownerId: null,
      pipelineId: null,
      stageId: null,
      notes: null,
      deletedAt: null,
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await createLead(createInput);

    expect(mockLeadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: orgId,
          source: 'website',
          status: 'new',
          priority: 'high',
          expectedValue: 5000,
        }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
    expect(result.source).toBe('website');
  });

  it('does not allow direct creation with converted status', async () => {
    await expect(createLead({ ...createInput, status: 'converted' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Lead conversion must use the lead conversion service',
    });

    expect(mockLeadCreate).not.toHaveBeenCalled();
  });

  it('throws 409 when duplicate lead detected', async () => {
    mockContactFindFirst.mockResolvedValue({ id: 'contact_1', organizationId: orgId });
    mockLeadFindFirst.mockResolvedValue({ id: 'existing_lead', organizationId: orgId });

    await expect(createLead({ ...createInput, contactId: 'contact_1' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('creates lead when overrideDuplicate is true', async () => {
    mockContactFindFirst.mockResolvedValue({ id: 'contact_1', organizationId: orgId });
    mockLeadFindFirst.mockResolvedValue({ id: 'existing_lead', organizationId: orgId });
    mockLeadCreate.mockResolvedValue({
      id: 'new_lead',
      organizationId: orgId,
      contactId: 'contact_1',
      accountId: null,
      source: 'website',
      status: 'new',
      priority: 'high',
      expectedValue: 5000,
      ownerId: null,
      pipelineId: null,
      stageId: null,
      notes: null,
      deletedAt: null,
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await createLead({ ...createInput, contactId: 'contact_1' }, true);
    expect(result.id).toBe('new_lead');
    expect(mockAuditLogCreate).toHaveBeenCalled();
    const calls = mockAuditLogCreate.mock.calls;
    expect(calls.length).toBe(1);
    const metadata = calls[0][0].data.metadata;
    expect(metadata).toMatchObject({ duplicateOverride: true });
  });

  it('validates owner membership when ownerId is provided', async () => {
    mockUserRoleFindFirst.mockResolvedValue(null);

    await expect(createLead({ ...createInput, ownerId: 'foreign_owner' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('validates cross-org contact relationship', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(
      createLead({ ...createInput, contactId: 'foreign_contact' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates cross-org account relationship', async () => {
    mockAccountFindFirst.mockResolvedValue(null);

    await expect(
      createLead({ ...createInput, accountId: 'foreign_account' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(createLead(createInput)).rejects.toThrow('Unauthenticated');
  });

  it('throws 403 when user lacks lead.create permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(createLead(createInput)).rejects.toThrow('Forbidden');
  });
});

describe('Lead service - updateLead', () => {
  it('updates lead for same org', async () => {
    const existing = {
      id: leadId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      source: 'website',
      status: 'new',
      priority: 'medium',
      expectedValue: 1000,
      ownerId: null,
      pipelineId: null,
      stageId: null,
      notes: null,
      deletedAt: null,
    };
    // 1st findFirst: existence check → returns existing lead
    // 2nd findFirst: duplicate detection → returns null (no duplicate)
    mockLeadFindFirst.mockResolvedValueOnce(existing);
    mockLeadFindFirst.mockResolvedValueOnce(null);
    mockLeadFindFirst.mockResolvedValue(existing);
    mockLeadUpdate.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      source: 'referral',
      status: 'new',
      priority: 'medium',
      expectedValue: 1000,
      ownerId: null,
      pipelineId: null,
      stageId: null,
      notes: null,
      deletedAt: null,
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await updateLead(leadId, { source: 'referral' } as LeadUpdateInput);
    expect(result.source).toBe('referral');
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it.each([
    { existingStatus: 'new', requestedStatus: 'converted' },
    { existingStatus: 'converted', requestedStatus: 'qualified' },
  ])(
    'routes Lead transitions into or out of converted through the conversion service',
    async ({ existingStatus, requestedStatus }) => {
      mockLeadFindFirst.mockResolvedValue({
        id: leadId,
        organizationId: orgId,
        source: 'website',
        status: existingStatus,
        priority: 'medium',
        contactId: null,
        accountId: null,
        ownerId: null,
        pipelineId: null,
        stageId: null,
        notes: null,
        deletedAt: null,
      });

      await expect(
        updateLead(leadId, { status: requestedStatus } as LeadUpdateInput)
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Lead conversion must use the lead conversion service',
      });

      expect(mockLeadUpdate).not.toHaveBeenCalled();
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    }
  );

  it('throws non-disclosing 404 for cross-org update', async () => {
    mockLeadFindFirst.mockResolvedValue(null);

    await expect(updateLead(leadId, { source: 'hacked' } as LeadUpdateInput)).rejects.toMatchObject(
      { statusCode: 404 }
    );
  });

  it('throws 403 when user lacks lead.update permission', async () => {
    mockLeadFindFirst.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      source: 'website',
      status: 'new',
      priority: 'medium',
      expectedValue: null,
      ownerId: null,
      pipelineId: null,
      stageId: null,
      notes: null,
      deletedAt: null,
    });
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(updateLead(leadId, { source: 'referral' } as LeadUpdateInput)).rejects.toThrow(
      'Forbidden'
    );
  });
});

describe('Lead service - deleteLead', () => {
  it('soft deletes lead for same org', async () => {
    mockLeadFindFirst.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      source: 'website',
      status: 'new',
      priority: 'medium',
      expectedValue: null,
      ownerId: null,
      pipelineId: null,
      stageId: null,
      notes: null,
      deletedAt: null,
    });
    mockLeadUpdate.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      deletedAt: new Date(),
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await deleteLead(leadId);
    expect(result.deletedAt).toBeDefined();
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: leadId },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('throws non-disclosing 404 for cross-org delete', async () => {
    mockLeadFindFirst.mockResolvedValue(null);

    await expect(deleteLead(leadId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 403 when user lacks lead.delete permission', async () => {
    mockLeadFindFirst.mockResolvedValue({
      id: leadId,
      organizationId: orgId,
      contactId: null,
      accountId: null,
      source: 'website',
      status: 'new',
      priority: 'medium',
      expectedValue: null,
      ownerId: null,
      pipelineId: null,
      stageId: null,
      notes: null,
      deletedAt: null,
    });
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(deleteLead(leadId)).rejects.toThrow('Forbidden');
  });
});

describe('Lead service - detectDuplicate regression', () => {
  it('returns no duplicate when no meaningful identifiers provided (no broad org-only matching)', async () => {
    mockLeadFindFirst.mockResolvedValue({ id: 'existing_lead', organizationId: orgId });

    const result = await checkDuplicate({
      contactId: null,
      accountId: null,
      source: null,
      status: null,
    } as unknown as LeadCreateInput);

    expect(result.isDuplicate).toBe(false);
    expect(result.duplicateId).toBeNull();
    // prisma.lead.findFirst should NOT be called when there are no identifiers
    expect(mockLeadFindFirst).not.toHaveBeenCalled();
  });

  it('returns duplicate when contactId + source + status match', async () => {
    mockLeadFindFirst.mockResolvedValue({ id: 'existing_lead', organizationId: orgId });

    const result = await checkDuplicate({
      contactId: 'contact_1',
      source: 'website',
      status: 'new',
    } as LeadCreateInput);

    expect(result.isDuplicate).toBe(true);
    expect(result.duplicateId).toBe('existing_lead');
    expect(mockLeadFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: orgId,
        deletedAt: null,
        contactId: 'contact_1',
        source: 'website',
        status: 'new',
      },
    });
  });
});

describe('Lead service - createLead org isolation regression', () => {
  const createInput = {
    source: 'website',
    status: 'new',
    priority: 'medium',
    expectedValue: null,
    contactId: null,
    accountId: null,
    ownerId: null,
    pipelineId: null,
    stageId: null,
    notes: null,
  } as LeadCreateInput;

  it('validates cross-org stage when stageId is provided without pipelineId', async () => {
    mockPipelineStageFindFirst.mockResolvedValue(null);

    await expect(createLead({ ...createInput, stageId: 'foreign_stage' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('allows stage from same org pipeline when pipelineId is provided', async () => {
    mockPipelineFindFirst.mockResolvedValue({ id: 'pipeline_1', organizationId: orgId });
    mockPipelineStageFindFirst.mockResolvedValue({ id: 'stage_1', pipelineId: 'pipeline_1' });
    mockLeadFindFirst.mockResolvedValue(null);
    mockLeadCreate.mockResolvedValue({
      id: 'new_lead',
      organizationId: orgId,
      contactId: null,
      accountId: null,
      source: 'website',
      status: 'new',
      priority: 'medium',
      expectedValue: null,
      ownerId: null,
      pipelineId: 'pipeline_1',
      stageId: 'stage_1',
      notes: null,
      deletedAt: null,
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await createLead({
      ...createInput,
      pipelineId: 'pipeline_1',
      stageId: 'stage_1',
    });
    expect(result.id).toBe('new_lead');
    expect(mockPipelineStageFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'stage_1',
        pipelineId: 'pipeline_1',
      },
      include: { pipeline: true },
    });
  });
});

describe('Lead service - updateLead org isolation regression', () => {
  const existingLead = {
    id: 'lead_1',
    organizationId: orgId,
    contactId: null,
    accountId: null,
    source: 'website',
    status: 'new',
    priority: 'medium',
    expectedValue: null,
    ownerId: null,
    pipelineId: null,
    stageId: null,
    notes: null,
    deletedAt: null,
  };

  it('validates cross-org stage when changing stageId without pipelineId', async () => {
    mockLeadFindFirst.mockResolvedValue(existingLead);
    mockPipelineStageFindFirst.mockResolvedValue(null);

    await expect(updateLead('lead_1', { stageId: 'foreign_stage' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('allows stage from same org when pipelineId is derived from existing lead', async () => {
    const leadWithPipeline = { ...existingLead, pipelineId: 'pipeline_1' };
    mockLeadFindFirst.mockResolvedValue(leadWithPipeline);
    mockPipelineStageFindFirst.mockResolvedValue({ id: 'stage_1', pipelineId: 'pipeline_1' });
    mockLeadUpdate.mockResolvedValue({ ...leadWithPipeline, stageId: 'stage_1' });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await updateLead('lead_1', { stageId: 'stage_1' });
    expect(result.stageId).toBe('stage_1');
    expect(mockPipelineStageFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'stage_1',
        pipelineId: 'pipeline_1',
      },
      include: { pipeline: true },
    });
  });
});
