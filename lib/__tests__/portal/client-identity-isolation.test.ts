/**
 * Unit tests: a client-portal identity can never obtain internal team authority.
 *
 * The portal creates identities as `userType = "client"` with no organization
 * membership and no `UserRole` rows. These tests assert the internal authorization
 * helpers fail closed for such a user — including the case where an organization id
 * has somehow been attached to the row.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    userRole: { findMany: vi.fn() },
  },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { prisma } from '@/lib/db';
import {
  getUserPermissions,
  hasPermission,
  requireOrganization,
  requirePermission,
} from '@/lib/permissions';

const mockUserFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockUserRoleFindMany = prisma.userRole.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireOrganization', () => {
  it('rejects a client identity that has no organization', async () => {
    mockUserFindUnique.mockResolvedValue({ organizationId: null, userType: 'client' });

    await expect(requireOrganization('client_user')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a client identity even when an organization id is present', async () => {
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org_1', userType: 'client' });

    await expect(requireOrganization('client_user')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects an unknown user', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    await expect(requireOrganization('missing_user')).rejects.toMatchObject({ statusCode: 403 });
  });

  // `status` defaults to "active" in the schema, so every real row carries it;
  // these mocks mirror the columns the query actually selects.
  it('accepts an active internal member with an organization', async () => {
    mockUserFindUnique.mockResolvedValue({
      organizationId: 'org_1',
      userType: 'internal',
      status: 'active',
    });

    await expect(requireOrganization('internal_user')).resolves.toEqual({
      organizationId: 'org_1',
    });
  });

  it('rejects a suspended internal member even with an organization', async () => {
    mockUserFindUnique.mockResolvedValue({
      organizationId: 'org_1',
      userType: 'internal',
      status: 'suspended',
    });

    await expect(requireOrganization('internal_user')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects an internal member whose status is missing', async () => {
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org_1', userType: 'internal' });

    await expect(requireOrganization('internal_user')).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('RBAC resolution for client identities', () => {
  it('resolves no permissions when the user has no role rows', async () => {
    mockUserRoleFindMany.mockResolvedValue([]);

    const permissions = await getUserPermissions('client_user', 'org_1');

    expect(permissions.size).toBe(0);
    expect(mockUserRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'client_user', organizationId: 'org_1' } })
    );
  });

  it('denies a permission check for a client with no organization', async () => {
    await expect(hasPermission('client_user', undefined, 'project.read')).resolves.toBe(false);
    await expect(requirePermission('client_user', undefined, 'project.read')).rejects.toMatchObject(
      {
        statusCode: 403,
      }
    );
    expect(mockUserRoleFindMany).not.toHaveBeenCalled();
  });

  it('denies an internal permission for a client whose only roles grant other codes', async () => {
    mockUserRoleFindMany.mockResolvedValue([
      { role: { permissions: [{ permission: { code: 'client.access.read' } }] } },
    ]);

    await expect(hasPermission('client_user', 'org_1', 'project.read')).resolves.toBe(false);
    await expect(requirePermission('client_user', 'org_1', 'user.update')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
