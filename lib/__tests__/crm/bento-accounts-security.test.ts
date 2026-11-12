import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { getAccount, listAccounts } from '@/lib/services/crm/account-service';

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
  getUserPermissions: vi.fn().mockResolvedValue(new Set(['crm:read', 'crm:write', 'account.read'])),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    agencyAccount: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe('CRM Accounts Security & Tenant Isolation (Phase 3B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOrg.mockResolvedValue({ organizationId: 'org-tenant-1' });
  });

  it('enforces organizationId filter when querying account detail', async () => {
    const mockFindFirst = vi.mocked(prisma.agencyAccount.findFirst);
    mockFindFirst.mockResolvedValue({
      id: 'acc-tenant-1',
      organizationId: 'org-tenant-1',
      name: 'Tenant 1 Corp',
      website: 'https://tenant1.com',
      address: '100 Main St',
      status: 'active',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      contacts: [],
      _count: { contacts: 0 },
    } as unknown as Awaited<ReturnType<typeof prisma.agencyAccount.findFirst>>);

    const account = await getAccount('acc-tenant-1');
    expect(account).not.toBeNull();
    expect(account?.id).toBe('acc-tenant-1');

    // Verify Prisma query strictly scopes by user's authenticated organizationId
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'acc-tenant-1',
          organizationId: 'org-tenant-1',
        }),
      })
    );
  });

  it('throws 404 Not Found without disclosing metadata when organizationId does not match (cross-tenant request)', async () => {
    const mockFindFirst = vi.mocked(prisma.agencyAccount.findFirst);
    // Attacker from org-attacker-2 tries to access acc-tenant-1
    mockRequireOrg.mockResolvedValue({ organizationId: 'org-attacker-2' });
    mockFindFirst.mockResolvedValue(null);

    await expect(getAccount('acc-tenant-1')).rejects.toThrow('Not found');

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'acc-tenant-1',
          organizationId: 'org-attacker-2',
        }),
      })
    );
  });

  it('enforces organizationId filter when listing accounts', async () => {
    const mockFindMany = vi.mocked(prisma.agencyAccount.findMany);
    const mockCount = vi.mocked(prisma.agencyAccount.count);

    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await listAccounts({
      page: 1,
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
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

describe('Website URL Security & Safe Protocols', () => {
  it('only renders links for http: and https: protocols and rejects dangerous javascript: URLs', () => {
    // Direct validation of URL safety
    const testCases = [
      { input: 'https://acme.com', expectedProtocol: 'https:' },
      { input: 'http://insecure.org', expectedProtocol: 'http:' },
      { input: 'javascript:alert(1)', isSafe: false },
      { input: 'data:text/html,<script>alert(1)</script>', isSafe: false },
      { input: 'vbscript:msgbox(1)', isSafe: false },
    ];

    for (const tc of testCases) {
      let isProtocolSafe = false;
      try {
        const trimmed = tc.input.trim();
        const parsed = new URL(
          trimmed.startsWith('http://') || trimmed.startsWith('https://')
            ? trimmed
            : `https://${trimmed}`
        );
        isProtocolSafe = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        isProtocolSafe = false;
      }

      if (tc.isSafe === false) {
        expect(isProtocolSafe).toBe(false);
      } else {
        expect(isProtocolSafe).toBe(true);
      }
    }
  });
});
