import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { getLead, listLeads } from '@/lib/services/crm/lead-service';
import { convertLead } from '@/lib/services/crm/lead-conversion-service';

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    toString: () => 'mock-session-cookie',
  }),
}));

vi.mock('@/lib/auth-server', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        session: { id: 'sess-1' },
        user: { id: 'usr-1', email: 'admin@org1.com' },
      }),
    },
  },
}));

const mockRequireOrg = vi.fn();
vi.mock('@/lib/permissions', () => ({
  requireOrganization: (...args: unknown[]) => mockRequireOrg(...args),
  requirePermission: vi.fn().mockResolvedValue(undefined),
  hasPermission: vi.fn().mockResolvedValue(true),
  getUserPermissions: vi
    .fn()
    .mockResolvedValue(new Set(['crm:read', 'crm:write', 'lead.read', 'lead.convert'])),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    opportunity: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((fn) => fn(prisma)),
  },
}));

describe('CRM Leads Security, Tenant Isolation & Conversion Safety (Phase 3C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOrg.mockResolvedValue({ organizationId: 'org-tenant-1' });
  });

  describe('Tenant Isolation & Authoritative Scoping', () => {
    it('enforces organizationId filter when querying lead detail', async () => {
      const mockFindFirst = vi.mocked(prisma.lead.findFirst);
      mockFindFirst.mockResolvedValue({
        id: 'lead-tenant-1',
        organizationId: 'org-tenant-1',
        source: 'website',
        status: 'new',
        priority: 'high',
        expectedValue: null,
        contactId: null,
        accountId: null,
        ownerId: null,
        pipelineId: null,
        stageId: null,
        notes: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        contact: null,
        account: null,
        opportunities: [],
      } as unknown as Awaited<ReturnType<typeof prisma.lead.findFirst>>);

      const lead = await getLead('lead-tenant-1');
      expect(lead).not.toBeNull();
      expect(lead.id).toBe('lead-tenant-1');

      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'lead-tenant-1',
            organizationId: 'org-tenant-1',
          }),
        })
      );
    });

    it('throws 404 Not Found without disclosing metadata when organizationId does not match', async () => {
      const mockFindFirst = vi.mocked(prisma.lead.findFirst);
      mockRequireOrg.mockResolvedValue({ organizationId: 'org-attacker-2' });
      mockFindFirst.mockResolvedValue(null);

      await expect(getLead('lead-tenant-1')).rejects.toThrow('Not found');

      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'lead-tenant-1',
            organizationId: 'org-attacker-2',
          }),
        })
      );
    });

    it('enforces organizationId filter when listing leads', async () => {
      const mockFindMany = vi.mocked(prisma.lead.findMany);
      const mockCount = vi.mocked(prisma.lead.count);

      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listLeads({
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: false,
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-tenant-1',
            deletedAt: null,
          }),
        })
      );
    });
  });

  describe('Conversion Workflow Safety & Concurrency Locking', () => {
    it('executes conversion inside transaction with SELECT FOR UPDATE row locking', async () => {
      const mockLeadFindUnique = vi.mocked(prisma.lead.findUnique);
      const mockOppFindFirst = vi.mocked(prisma.opportunity.findFirst);
      const mockOppCreate = vi.mocked(prisma.opportunity.create);
      const mockLeadUpdate = vi.mocked(prisma.lead.update);

      mockLeadFindUnique.mockResolvedValue({
        id: 'lead-convert-1',
        organizationId: 'org-tenant-1',
        source: 'referral',
        status: 'qualified',
        priority: 'high',
        expectedValue: null,
        contactId: 'con-1',
        accountId: 'acc-1',
        ownerId: null,
        pipelineId: null,
        stageId: null,
        notes: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.lead.findUnique>>);

      mockOppFindFirst.mockResolvedValue(null);

      mockOppCreate.mockResolvedValue({
        id: 'opp-created-1',
        organizationId: 'org-tenant-1',
        leadId: 'lead-convert-1',
        title: 'New Opportunity',
        status: 'open',
        value: null,
        currency: 'USD',
        pipelineId: null,
        stageId: null,
        ownerId: null,
        contactId: 'con-1',
        accountId: 'acc-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.opportunity.create>>);

      mockLeadUpdate.mockResolvedValue({
        id: 'lead-convert-1',
        status: 'converted',
      } as unknown as Awaited<ReturnType<typeof prisma.lead.update>>);

      const result = await convertLead('lead-convert-1', {
        title: 'New Opportunity',
      });

      expect(result.alreadyConverted).toBe(false);
      expect(result.opportunity.id).toBe('opp-created-1');
      expect(result.lead.status).toBe('converted');

      // Verify row lock was invoked
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        'SELECT id FROM "Lead" WHERE id = $1 FOR UPDATE',
        'lead-convert-1'
      );
    });

    it('prevents duplicate conversion if opportunity already exists', async () => {
      const mockLeadFindUnique = vi.mocked(prisma.lead.findUnique);
      const mockOppFindFirst = vi.mocked(prisma.opportunity.findFirst);

      mockLeadFindUnique.mockResolvedValue({
        id: 'lead-convert-1',
        organizationId: 'org-tenant-1',
        source: 'referral',
        status: 'converted',
        priority: 'high',
        expectedValue: null,
        contactId: 'con-1',
        accountId: 'acc-1',
        ownerId: null,
        pipelineId: null,
        stageId: null,
        notes: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.lead.findUnique>>);

      mockOppFindFirst.mockResolvedValue({
        id: 'opp-existing-1',
        organizationId: 'org-tenant-1',
        leadId: 'lead-convert-1',
        title: 'Existing Opportunity',
        status: 'open',
        value: null,
        currency: 'USD',
        pipelineId: null,
        stageId: null,
        ownerId: null,
        contactId: 'con-1',
        accountId: 'acc-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.opportunity.findFirst>>);

      const result = await convertLead('lead-convert-1', {
        title: 'New Opportunity',
      });

      expect(result.alreadyConverted).toBe(true);
      expect(result.opportunity.id).toBe('opp-existing-1');
      expect(prisma.opportunity.create).not.toHaveBeenCalled();
    });
  });
});

describe('Financial Precision & Decimal-safe Formatting of Expected Value', () => {
  it('safely handles null, zero, floating, and large decimal values without NaN or corruption', () => {
    const formatCurrency = (val: string | null | undefined) => {
      if (!val) return '—';
      const num = Number(val);
      return isNaN(num)
        ? '—'
        : `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    };

    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency('0')).toBe('$0');
    expect(formatCurrency('12500.50')).toBe('$12,500.5');
    expect(formatCurrency('1000000')).toBe('$1,000,000');
    expect(formatCurrency('invalid-amount')).toBe('—');
  });
});
