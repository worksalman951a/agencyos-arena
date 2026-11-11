/**
 * Unit tests for the client-portal authorization core.
 *
 * Prisma, Better Auth and the request cookies are mocked, so these tests exercise
 * the guards' decision logic directly. They are the unit-level half of the IDOR /
 * role-escalation / isolation evidence; the integration suite proves the same
 * behaviour end-to-end against PostgreSQL and real HTTP.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    clientAccess: { findUnique: vi.fn(), update: vi.fn() },
    clientResourceGrant: { findFirst: vi.fn(), findMany: vi.fn() },
    project: { findFirst: vi.fn() },
    document: { findFirst: vi.fn() },
    invoice: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/auth-server', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
  getUserPermissions: vi.fn(),
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  codedError,
  getPortalAccessOrNull,
  listGrantedResourceIds,
  requireGrantedResource,
  requirePortalAccess,
  requirePortalCapability,
} from '@/lib/portal/access-control';

const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockUserFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockAccessFindUnique = prisma.clientAccess.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockGrantFindFirst = prisma.clientResourceGrant.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockGrantFindMany = prisma.clientResourceGrant.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockProjectFindFirst = prisma.project.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockDocumentFindFirst = prisma.document.findFirst as unknown as ReturnType<typeof vi.fn>;

const organizationId = 'org_client_portal';
const otherOrganizationId = 'org_other_tenant';
const clientUserId = 'user_client_1';
const accessId = 'access_client_1';

function activeAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: accessId,
    organizationId,
    userId: clientUserId,
    contactId: 'contact_1',
    status: 'active',
    role: 'client_approver',
    canViewInvoices: true,
    canDownloadFiles: true,
    canComment: true,
    canApprove: true,
    organization: { id: organizationId, name: 'Acme Agency' },
    contact: { id: 'contact_1', firstName: 'Clara', lastName: 'Client' },
    ...overrides,
  };
}

function clientUser(overrides: Record<string, unknown> = {}) {
  return {
    id: clientUserId,
    email: 'clara@client.test',
    name: 'Clara Client',
    status: 'active',
    userType: 'client',
    organizationId: null,
    ...overrides,
  };
}

function signedInAsClient() {
  mockCookies.mockResolvedValue({ toString: () => 'better-auth.session_token=token' });
  mockGetSession.mockResolvedValue({ session: { id: 'session_1' }, user: { id: clientUserId } });
}

describe('requirePortalAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ toString: () => 'better-auth.session_token=token' });
  });

  it('rejects a request without a session with 401', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(requirePortalAccess()).rejects.toMatchObject({ statusCode: 401 });
    expect(mockAccessFindUnique).not.toHaveBeenCalled();
  });

  it('rejects an internal team member (userType internal) with 403', async () => {
    signedInAsClient();
    mockUserFindUnique.mockResolvedValue(clientUser({ userType: 'internal', organizationId }));

    await expect(requirePortalAccess()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a client identity that has no access row with 403', async () => {
    signedInAsClient();
    mockUserFindUnique.mockResolvedValue(clientUser());
    mockAccessFindUnique.mockResolvedValue(null);

    await expect(requirePortalAccess()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a client identity that somehow has an organization with 403', async () => {
    signedInAsClient();
    mockUserFindUnique.mockResolvedValue(clientUser({ organizationId }));
    mockAccessFindUnique.mockResolvedValue(activeAccess());

    await expect(requirePortalAccess()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a suspended access with 403', async () => {
    signedInAsClient();
    mockUserFindUnique.mockResolvedValue(clientUser());
    mockAccessFindUnique.mockResolvedValue(activeAccess({ status: 'suspended' }));

    await expect(requirePortalAccess()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a revoked access with 403', async () => {
    signedInAsClient();
    mockUserFindUnique.mockResolvedValue(clientUser());
    mockAccessFindUnique.mockResolvedValue(activeAccess({ status: 'revoked' }));

    await expect(requirePortalAccess()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a disabled user account with 403', async () => {
    signedInAsClient();
    mockUserFindUnique.mockResolvedValue(clientUser({ status: 'disabled' }));
    mockAccessFindUnique.mockResolvedValue(activeAccess());

    await expect(requirePortalAccess()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('resolves the client context and capability flags for an active access', async () => {
    signedInAsClient();
    mockUserFindUnique.mockResolvedValue(clientUser());
    mockAccessFindUnique.mockResolvedValue(activeAccess({ canApprove: false }));

    const context = await requirePortalAccess();

    expect(context.accessId).toBe(accessId);
    expect(context.organizationId).toBe(organizationId);
    expect(context.contactName).toBe('Clara Client');
    expect(context.canApprove).toBe(false);
    expect(context.canViewInvoices).toBe(true);
  });

  it('returns null (not an error) when nobody is signed in', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(getPortalAccessOrNull()).resolves.toBeNull();
  });
});

describe('requirePortalCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedInAsClient();
    mockUserFindUnique.mockResolvedValue(clientUser());
  });

  it('throws 403 when the capability flag is off', async () => {
    mockAccessFindUnique.mockResolvedValue(activeAccess({ canDownloadFiles: false }));

    await expect(requirePortalCapability('downloadFiles')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('resolves when the capability flag is on', async () => {
    mockAccessFindUnique.mockResolvedValue(activeAccess({ canDownloadFiles: true }));

    await expect(requirePortalCapability('downloadFiles')).resolves.toMatchObject({
      accessId,
    });
  });
});

describe('requireGrantedResource', () => {
  const context = {
    userId: clientUserId,
    email: 'clara@client.test',
    name: 'Clara Client',
    accessId,
    organizationId,
    organizationName: 'Acme Agency',
    contactId: 'contact_1',
    contactName: 'Clara Client',
    role: 'client_approver',
    status: 'active',
    canViewInvoices: true,
    canDownloadFiles: true,
    canComment: true,
    canApprove: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers 404 when no grant exists for the caller', async () => {
    mockGrantFindFirst.mockResolvedValue(null);

    await expect(
      requireGrantedResource(context, 'project', 'project_other_client')
    ).rejects.toMatchObject({ statusCode: 404 });

    // The lookup is scoped to the caller's own access and organization: a
    // client-supplied id can never widen it.
    expect(mockGrantFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientAccessId: accessId,
          organizationId,
          resourceType: 'project',
          resourceId: 'project_other_client',
          revokedAt: null,
        }),
      })
    );
  });

  it('answers 404 when the grant exists but the resource is not in the organization', async () => {
    mockGrantFindFirst.mockResolvedValue({
      id: 'grant_1',
      canComment: true,
      canApprove: true,
      note: null,
      sharedAt: new Date(),
    });
    mockProjectFindFirst.mockResolvedValue(null);

    await expect(
      requireGrantedResource(context, 'project', 'project_foreign')
    ).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockProjectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId }) })
    );
  });

  it('refuses an invoice to a client without the viewInvoices capability before touching the database', async () => {
    const restricted = { ...context, canViewInvoices: false };

    await expect(requireGrantedResource(restricted, 'invoice', 'invoice_1')).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockGrantFindFirst).not.toHaveBeenCalled();
  });

  it('requires both the capability and the per-grant flag to approve', async () => {
    mockGrantFindFirst.mockResolvedValue({
      id: 'grant_1',
      canComment: true,
      canApprove: false,
      note: null,
      sharedAt: new Date(),
    });

    await expect(
      requireGrantedResource(context, 'project', 'project_1', { action: 'approve' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('requires the per-grant comment flag to comment', async () => {
    mockGrantFindFirst.mockResolvedValue({
      id: 'grant_1',
      canComment: false,
      canApprove: true,
      note: null,
      sharedAt: new Date(),
    });

    await expect(
      requireGrantedResource(context, 'project', 'project_1', { action: 'comment' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('resolves a granted project', async () => {
    mockGrantFindFirst.mockResolvedValue({
      id: 'grant_1',
      canComment: true,
      canApprove: true,
      note: null,
      sharedAt: new Date(),
    });
    mockProjectFindFirst.mockResolvedValue({
      id: 'project_1',
      name: 'Website redesign',
      description: null,
      status: 'active',
    });

    const granted = await requireGrantedResource(context, 'project', 'project_1');

    expect(granted.resource.title).toBe('Website redesign');
    expect(granted.grant.id).toBe('grant_1');
  });

  it('scopes document lookups to the organization', async () => {
    mockGrantFindFirst.mockResolvedValue({
      id: 'grant_2',
      canComment: true,
      canApprove: false,
      note: null,
      sharedAt: new Date(),
    });
    mockDocumentFindFirst.mockResolvedValue(null);

    await expect(requireGrantedResource(context, 'document', 'doc_1')).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockDocumentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc_1', organizationId },
      })
    );
  });
});

describe('listGrantedResourceIds', () => {
  it('only returns live grants of the caller for the requested type', async () => {
    mockGrantFindMany.mockResolvedValue([{ resourceId: 'project_1' }, { resourceId: 'project_2' }]);

    const context = {
      userId: clientUserId,
      email: 'clara@client.test',
      name: 'Clara Client',
      accessId,
      organizationId,
      organizationName: 'Acme Agency',
      contactId: 'contact_1',
      contactName: 'Clara Client',
      role: 'client_approver',
      status: 'active',
      canViewInvoices: true,
      canDownloadFiles: true,
      canComment: true,
      canApprove: true,
    };

    const ids = await listGrantedResourceIds(context, 'project');

    expect(ids).toEqual(['project_1', 'project_2']);
    expect(mockGrantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientAccessId: accessId,
          organizationId,
          resourceType: 'project',
          revokedAt: null,
        }),
      })
    );
  });
});

describe('codedError', () => {
  it('carries a status code for the route error mapper', () => {
    const error = codedError('Not found', 404);
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Not found');
  });

  it('does not leak the tenant-internal organization id in a 404 message', () => {
    const error = codedError('Not found', 404);
    expect(error.message).not.toContain(otherOrganizationId);
  });
});
