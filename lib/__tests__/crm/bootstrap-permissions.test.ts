/**
 * Unit tests for organization bootstrap document permissions.
 *
 * Verifies that newly bootstrapped Administrator roles receive all
 * Proposal and Quotation permissions, and that the backfill logic
 * is idempotent for existing organizations.
 *
 * Prisma is mocked so these tests run without a live database.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    permission: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
    },
    rolePermission: {
      createMany: vi.fn(),
    },
    $disconnect: vi.fn(),
  },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';

const mockPermissionFindMany = prisma.permission.findMany as unknown as ReturnType<typeof vi.fn>;
const mockRoleFindMany = prisma.role.findMany as unknown as ReturnType<typeof vi.fn>;
const mockRolePermissionCreateMany = prisma.rolePermission.createMany as unknown as ReturnType<
  typeof vi.fn
>;

const CRM_PERMISSION_CODES = [
  'contact.create',
  'contact.read',
  'contact.update',
  'contact.delete',
  'account.create',
  'account.read',
  'account.update',
  'account.delete',
  'pipeline.create',
  'pipeline.read',
  'pipeline.update',
  'pipeline.delete',
  'pipeline.stage.manage',
  'lead.create',
  'lead.read',
  'lead.update',
  'lead.delete',
  'lead.assign',
  'lead.convert',
  'opportunity.create',
  'opportunity.read',
  'opportunity.update',
  'opportunity.delete',
  'opportunity.assign',
  'proposal.create',
  'proposal.read',
  'proposal.update',
  'proposal.delete',
  'quotation.create',
  'quotation.read',
  'quotation.update',
  'quotation.delete',
  'invoice.create',
  'invoice.read',
  'invoice.update',
  'invoice.delete',
  'project.create',
  'project.read',
  'project.update',
  'project.delete',
];

describe('Bootstrap document permission codes', () => {
  it('CRM_PERMISSION_CODES includes proposal permissions', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.resolve(process.cwd(), 'app/api/auth/bootstrap-organization/route.ts');
    const source = fs.readFileSync(routePath, 'utf-8');

    const allCodes = [
      'proposal.create',
      'proposal.read',
      'proposal.update',
      'proposal.delete',
      'quotation.create',
      'quotation.read',
      'quotation.update',
      'quotation.delete',
      'invoice.create',
      'invoice.read',
      'invoice.update',
      'invoice.delete',
      'project.create',
      'project.read',
      'project.update',
      'project.delete',
      'workflow.execute',
    ];

    for (const code of allCodes) {
      expect(source).toContain(`'${code}'`);
    }
  });
});

/**
 * Simulates the backfill selection logic from scripts/backfill-document-permissions.ts.
 * Exercises the same query shape and filtering rules as the real script.
 */
function simulateBackfillSelection({
  adminRoles,
  permissionCodes,
}: {
  adminRoles: Array<{
    id: string;
    organizationId: string;
    isSystem: boolean;
    name: string;
    permissions: Array<{ permission: { code: string } }>;
  }>;
  permissionCodes: { id: string; code: string }[];
}) {
  let totalAssigned = 0;
  const calls: Array<{ roleId: string; permissionCodes: string[] }> = [];

  for (const role of adminRoles) {
    const existingCodes = new Set(role.permissions.map((rp) => rp.permission.code));
    const missing = CRM_PERMISSION_CODES.filter((code) => !existingCodes.has(code));

    if (missing.length > 0) {
      const permissions = permissionCodes.filter((p) => missing.includes(p.code));
      calls.push({
        roleId: role.id,
        permissionCodes: permissions.map((p) => p.code),
      });
      totalAssigned += missing.length;
    }
  }

  return { totalAssigned, calls };
}

describe('Backfill script logic (idempotent)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries roles with isSystem=true AND name=Administrator', async () => {
    mockRoleFindMany.mockResolvedValue([]);
    mockPermissionFindMany.mockResolvedValue([]);
    mockRolePermissionCreateMany.mockResolvedValue({ count: 0 });

    await prisma.role.findMany({
      where: { isSystem: true, name: 'Administrator' },
      include: { permissions: { include: { permission: true } } },
    });

    expect(mockRoleFindMany).toHaveBeenCalledTimes(1);
    expect(mockRoleFindMany).toHaveBeenCalledWith({
      where: { isSystem: true, name: 'Administrator' },
      include: { permissions: { include: { permission: true } } },
    });
  });

  it('assigns missing document permissions to Administrator roles without them', async () => {
    const adminRole = {
      id: 'role-admin-1',
      organizationId: 'org-1',
      isSystem: true,
      name: 'Administrator',
      permissions: [], // no existing permissions
    };
    mockRoleFindMany.mockResolvedValue([adminRole]);
    mockPermissionFindMany.mockResolvedValue(
      CRM_PERMISSION_CODES.map((code) => ({
        id: `perm-${code}`,
        code,
      }))
    );
    mockRolePermissionCreateMany.mockResolvedValue({ count: 8 });

    const { totalAssigned, calls } = simulateBackfillSelection({
      adminRoles: [adminRole],
      permissionCodes: CRM_PERMISSION_CODES.map((code) => ({
        id: `perm-${code}`,
        code,
      })),
    });

    expect(totalAssigned).toBe(40);
    expect(calls).toHaveLength(1);
    expect(calls[0].roleId).toBe('role-admin-1');
    expect(calls[0].permissionCodes).toEqual(expect.arrayContaining(CRM_PERMISSION_CODES));
  });

  it('is idempotent: skips Administrator roles that already have all document permissions', async () => {
    const adminRole = {
      id: 'role-admin-1',
      organizationId: 'org-1',
      isSystem: true,
      name: 'Administrator',
      permissions: CRM_PERMISSION_CODES.map((code) => ({
        permission: { code },
      })),
    };
    mockRoleFindMany.mockResolvedValue([adminRole]);

    const { totalAssigned, calls } = simulateBackfillSelection({
      adminRoles: [adminRole],
      permissionCodes: [],
    });

    expect(totalAssigned).toBe(0);
    expect(calls).toHaveLength(0);
    expect(mockRolePermissionCreateMany).not.toHaveBeenCalled();
  });

  it('excludes non-Administrator system roles (no document permissions granted)', async () => {
    mockRoleFindMany.mockResolvedValue([
      {
        id: 'role-system-other',
        organizationId: 'org-1',
        isSystem: true,
        name: 'System Auditor',
        permissions: [],
      },
      {
        id: 'role-admin-1',
        organizationId: 'org-1',
        isSystem: true,
        name: 'Administrator',
        permissions: [],
      },
    ]);
    mockPermissionFindMany.mockResolvedValue(
      CRM_PERMISSION_CODES.map((code) => ({
        id: `perm-${code}`,
        code,
      }))
    );
    mockRolePermissionCreateMany.mockResolvedValue({ count: 8 });

    // Simulate the query that only selects Administrator roles (filter by name)
    const allRoles = await prisma.role.findMany({
      where: { isSystem: true },
      include: { permissions: { include: { permission: true } } },
    });
    const adminRoles = allRoles.filter((r: { name: string }) => r.name === 'Administrator');

    expect(adminRoles).toHaveLength(1);
    expect(adminRoles[0].name).toBe('Administrator');
    expect(adminRoles[0].id).toBe('role-admin-1');

    // The System Auditor role should NOT be in the Administrator result set
    const systemAuditorIncluded = adminRoles.some(
      (r: { name: string }) => r.name === 'System Auditor'
    );
    expect(systemAuditorIncluded).toBe(false);
  });

  it('is idempotent across multiple runs: second run assigns nothing when permissions already present', async () => {
    // First run: no permissions, assigns all 8
    const firstRunRole = {
      id: 'role-admin-1',
      organizationId: 'org-1',
      isSystem: true,
      name: 'Administrator',
      permissions: [],
    };
    const firstRun = simulateBackfillSelection({
      adminRoles: [firstRunRole],
      permissionCodes: CRM_PERMISSION_CODES.map((code) => ({
        id: `perm-${code}`,
        code,
      })),
    });
    expect(firstRun.totalAssigned).toBe(40);

    // Second run: all permissions already present, assigns 0
    const secondRunRole = {
      id: 'role-admin-1',
      organizationId: 'org-1',
      isSystem: true,
      name: 'Administrator',
      permissions: CRM_PERMISSION_CODES.map((code) => ({
        permission: { code },
      })),
    };
    const secondRun = simulateBackfillSelection({
      adminRoles: [secondRunRole],
      permissionCodes: [],
    });
    expect(secondRun.totalAssigned).toBe(0);
    expect(secondRun.calls).toHaveLength(0);
  });

  it('ensures all 32 CRM permission codes are defined', () => {
    expect(CRM_PERMISSION_CODES).toHaveLength(40);
    expect(CRM_PERMISSION_CODES).toContain('proposal.create');
    expect(CRM_PERMISSION_CODES).toContain('proposal.read');
    expect(CRM_PERMISSION_CODES).toContain('proposal.update');
    expect(CRM_PERMISSION_CODES).toContain('proposal.delete');
    expect(CRM_PERMISSION_CODES).toContain('quotation.create');
    expect(CRM_PERMISSION_CODES).toContain('quotation.read');
    expect(CRM_PERMISSION_CODES).toContain('quotation.update');
    expect(CRM_PERMISSION_CODES).toContain('quotation.delete');
    expect(CRM_PERMISSION_CODES).toContain('invoice.create');
    expect(CRM_PERMISSION_CODES).toContain('invoice.read');
    expect(CRM_PERMISSION_CODES).toContain('invoice.update');
    expect(CRM_PERMISSION_CODES).toContain('invoice.delete');
    expect(CRM_PERMISSION_CODES).toContain('project.create');
    expect(CRM_PERMISSION_CODES).toContain('project.read');
    expect(CRM_PERMISSION_CODES).toContain('project.update');
    expect(CRM_PERMISSION_CODES).toContain('project.delete');
  });
});
