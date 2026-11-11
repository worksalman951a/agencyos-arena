/**
 * Unit tests for client-portal invitations.
 *
 * Focus: the properties that make an invitation safe to send by e-mail — hashed
 * token, expiry, revocation, single use (replay), e-mail binding, and the refusal
 * to convert an internal team member (or another client) into a client of this
 * organization.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    contact: { findFirst: vi.fn() },
    clientAccess: { findFirst: vi.fn(), findUnique: vi.fn() },
    clientInvitation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    userRole: { count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth-server', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/portal/audit', () => ({ writePortalAudit: vi.fn() }));
vi.mock('@/lib/portal/notify', () => ({ notifyUser: vi.fn(), notifyInternalStaff: vi.fn() }));
vi.mock('@/lib/portal/internal-actor', () => ({ requireInternalActor: vi.fn() }));

import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { requireInternalActor } from '@/lib/portal/internal-actor';
import {
  acceptClientInvitation,
  createClientInvitation,
  getClientInvitationByToken,
  revokeClientInvitation,
} from '@/lib/services/portal/client-invitation-service';

const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRequireInternalActor = requireInternalActor as unknown as ReturnType<typeof vi.fn>;
const mockUserFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockContactFindFirst = prisma.contact.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAccessFindFirst = prisma.clientAccess.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAccessFindUnique = prisma.clientAccess.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockInvitationFindUnique = prisma.clientInvitation.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const mockInvitationFindFirst = prisma.clientInvitation.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockInvitationCreate = prisma.clientInvitation.create as unknown as ReturnType<typeof vi.fn>;
const mockInvitationUpdate = prisma.clientInvitation.update as unknown as ReturnType<typeof vi.fn>;
const mockInvitationUpdateMany = prisma.clientInvitation.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockUserRoleCount = prisma.userRole.count as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

const organizationId = 'org_1';
const rawToken = 'a'.repeat(43);

function hash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invitation_1',
    organizationId,
    email: 'clara@client.test',
    contactId: 'contact_1',
    accountId: null,
    tokenHash: hash(rawToken),
    status: 'pending',
    role: 'client_approver',
    canViewInvoices: true,
    canDownloadFiles: true,
    canComment: true,
    canApprove: true,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    invitedBy: 'admin_1',
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('createClientInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireInternalActor.mockResolvedValue({
      userId: 'admin_1',
      organizationId,
      email: 'admin@agency.test',
      role: 'employee',
    });
    mockContactFindFirst.mockResolvedValue({
      id: 'contact_1',
      email: 'clara@client.test',
      firstName: 'Clara',
      lastName: 'Client',
      accountId: 'account_1',
    });
    mockAccessFindFirst.mockResolvedValue(null);
    mockInvitationFindFirst.mockResolvedValue(null);
    mockInvitationCreate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'invitation_1',
        createdAt: new Date(),
        ...data,
      })
    );
  });

  it('stores only the SHA-256 hash of the token and returns the raw token once', async () => {
    const result = await createClientInvitation({
      email: 'clara@client.test',
      contactId: 'contact_1',
      role: 'client_approver',
    });

    const stored = mockInvitationCreate.mock.calls[0][0].data as { tokenHash: string };

    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.tokenHash).not.toBe(result.token);
    expect(stored.tokenHash).toBe(hash(result.token));
    expect(JSON.stringify(stored)).not.toContain(result.token);
    expect(result.acceptPath).toBe(`/portal/invite/${result.token}`);
  });

  it('never stores an organization role or membership', async () => {
    await createClientInvitation({
      email: 'clara@client.test',
      contactId: 'contact_1',
      role: 'client_viewer',
    });

    const stored = mockInvitationCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(stored).not.toHaveProperty('roleId');
    expect(stored.role).toBe('client_viewer');
  });

  it('rejects an e-mail that does not match the CRM contact', async () => {
    await expect(
      createClientInvitation({
        email: 'someone-else@client.test',
        contactId: 'contact_1',
        role: 'client_viewer',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a contact from another organization (404, no disclosure)', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_other_tenant',
        role: 'client_viewer',
      })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockContactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId }),
      })
    );
  });

  it('rejects a contact that already has active portal access', async () => {
    mockAccessFindFirst.mockResolvedValue({ id: 'access_1', status: 'active' });

    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_1',
        role: 'client_viewer',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a second live invitation for the same address', async () => {
    mockInvitationFindFirst.mockResolvedValue({
      id: 'invitation_live',
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_1',
        role: 'client_viewer',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects unknown or privileged fields in the payload', async () => {
    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_1',
        role: 'client_viewer',
        organizationId: 'org_other',
      } as unknown)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an internal role value', async () => {
    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_1',
        role: 'administrator',
      } as unknown)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('getClientInvitationByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers 404 for an unknown token', async () => {
    mockInvitationFindUnique.mockResolvedValue(null);

    await expect(getClientInvitationByToken(rawToken)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('looks the invitation up by hash, never by raw token', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation(),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });

    await getClientInvitationByToken(rawToken);

    expect(mockInvitationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hash(rawToken) } })
    );
  });

  it('answers 410 for an expired invitation and records the expiry', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation({ expiresAt: new Date(Date.now() - 1000) }),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });
    mockInvitationUpdateMany.mockResolvedValue({ count: 1 });

    await expect(getClientInvitationByToken(rawToken)).rejects.toMatchObject({ statusCode: 410 });
    expect(mockInvitationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'invitation_1', status: 'pending' },
      data: { status: 'expired' },
    });
  });

  it('answers 410 for a revoked invitation', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation({ status: 'revoked' }),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });

    await expect(getClientInvitationByToken(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('answers 410 for an already accepted invitation (replay)', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation({ status: 'accepted' }),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });

    await expect(getClientInvitationByToken(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('discloses only invitee-facing fields', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation(),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });

    const result = await getClientInvitationByToken(rawToken);

    expect(result).toEqual({
      id: 'invitation_1',
      email: 'clara@client.test',
      organizationName: 'Acme Agency',
      contactName: 'Clara Client',
      expiresAt: expect.any(Date),
      capabilities: expect.arrayContaining(['approve work']),
    });
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).not.toHaveProperty('organizationId');
  });
});

describe('acceptClientInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ toString: () => 'better-auth.session_token=token' });
    mockGetSession.mockResolvedValue({
      session: { id: 'session_1' },
      user: { id: 'user_client_1', email: 'clara@client.test' },
    });
    mockInvitationFindUnique.mockResolvedValue(invitation());
    mockUserFindUnique.mockResolvedValue({
      id: 'user_client_1',
      organizationId: null,
      userType: 'internal',
      status: 'active',
    });
    mockUserRoleCount.mockResolvedValue(0);
    mockAccessFindUnique.mockResolvedValue(null);
    mockInvitationUpdateMany.mockResolvedValue({ count: 1 });

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        clientInvitation: {
          updateMany: mockInvitationUpdateMany,
        },
        clientAccess: {
          findUnique: mockAccessFindUnique,
          create: vi.fn().mockResolvedValue({ id: 'access_1', organizationId }),
        },
        user: { update: vi.fn().mockResolvedValue({}) },
      })
    );
  });

  it('rejects an unauthenticated acceptance with 401', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects acceptance by a different e-mail address with 403', async () => {
    mockGetSession.mockResolvedValue({
      session: { id: 'session_1' },
      user: { id: 'user_other', email: 'someone@else.test' },
    });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects an internal team member so a session cannot be converted', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'user_client_1',
      organizationId,
      userType: 'internal',
      status: 'active',
    });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a user that already holds an organization role', async () => {
    mockUserRoleCount.mockResolvedValue(1);

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a disabled account', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'user_client_1',
      organizationId: null,
      userType: 'internal',
      status: 'disabled',
    });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a replayed acceptance with 410 when the claim loses the race', async () => {
    mockInvitationUpdateMany.mockResolvedValue({ count: 0 });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('rejects a second portal identity for the same user with 409', async () => {
    mockAccessFindUnique.mockResolvedValue({ id: 'access_existing' });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('claims the invitation atomically and creates a client identity with no organization', async () => {
    const createdAccess: Array<Record<string, unknown>> = [];
    const updatedUser: Array<Record<string, unknown>> = [];

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        clientInvitation: { updateMany: mockInvitationUpdateMany },
        clientAccess: {
          findUnique: mockAccessFindUnique,
          create: vi
            .fn()
            .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
              createdAccess.push(data);
              return { id: 'access_1', organizationId };
            }),
        },
        user: {
          update: vi
            .fn()
            .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
              updatedUser.push(data);
              return {};
            }),
        },
      })
    );

    const result = await acceptClientInvitation(rawToken);

    expect(result).toEqual({ clientAccessId: 'access_1', organizationId });

    // The claim is conditional: only a still-pending, still-valid row is consumed.
    expect(mockInvitationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'invitation_1', status: 'pending', expiresAt: { gt: expect.any(Date) } },
      data: {
        status: 'accepted',
        acceptedAt: expect.any(Date),
        acceptedByUserId: 'user_client_1',
      },
    });

    expect(createdAccess[0]).toMatchObject({
      organizationId,
      userId: 'user_client_1',
      contactId: 'contact_1',
      status: 'active',
      canApprove: true,
    });

    // The identity is a client and is kept out of every organization.
    expect(updatedUser[0]).toMatchObject({
      userType: 'client',
      organizationId: null,
      status: 'active',
    });
  });

  it('answers 410 for an expired invitation', async () => {
    mockInvitationFindUnique.mockResolvedValue(
      invitation({ expiresAt: new Date(Date.now() - 1000) })
    );

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('answers 410 for a revoked invitation', async () => {
    mockInvitationFindUnique.mockResolvedValue(invitation({ status: 'revoked' }));

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });
});

describe('revokeClientInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireInternalActor.mockResolvedValue({
      userId: 'admin_1',
      organizationId,
      email: 'admin@agency.test',
      role: 'employee',
    });
  });

  it('scopes the lookup to the actor organization', async () => {
    mockInvitationFindFirst.mockResolvedValue(null);

    await expect(revokeClientInvitation('invitation_other_tenant')).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockInvitationFindFirst).toHaveBeenCalledWith({
      where: { id: 'invitation_other_tenant', organizationId },
    });
  });

  it('refuses to revoke an already accepted invitation', async () => {
    mockInvitationFindFirst.mockResolvedValue(invitation({ status: 'accepted' }));

    await expect(revokeClientInvitation('invitation_1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('revokes a pending invitation', async () => {
    mockInvitationFindFirst.mockResolvedValue(invitation());
    mockInvitationUpdate.mockResolvedValue({ id: 'invitation_1', status: 'revoked' });

    const result = await revokeClientInvitation('invitation_1');

    expect(result).toEqual({ id: 'invitation_1', status: 'revoked' });
    expect(mockInvitationUpdate).toHaveBeenCalledWith({
      where: { id: 'invitation_1' },
      data: { status: 'revoked', revokedAt: expect.any(Date) },
    });
  });
});
