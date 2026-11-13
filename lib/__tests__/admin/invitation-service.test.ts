import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authGetSession: vi.fn(),
  cookies: vi.fn(),
  requireOrganization: vi.fn(),
  requirePermission: vi.fn(),
  getUserPermissions: vi.fn(),
  sendEmail: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  userFindFirst: vi.fn(),
  roleFindFirst: vi.fn(),
  invitationUpdateMany: vi.fn(),
  invitationFindFirst: vi.fn(),
  invitationCreate: vi.fn(),
  organizationFindUniqueOrThrow: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst },
    role: { findFirst: mocks.roleFindFirst },
    invitation: {
      updateMany: mocks.invitationUpdateMany,
      findFirst: mocks.invitationFindFirst,
      create: mocks.invitationCreate,
    },
    organization: { findUniqueOrThrow: mocks.organizationFindUniqueOrThrow },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
    $queryRawUnsafe: mocks.queryRaw,
  },
}));
vi.mock('@/lib/permissions', () => ({
  getUserPermissions: mocks.getUserPermissions,
  requireOrganization: mocks.requireOrganization,
  requirePermission: mocks.requirePermission,
}));
vi.mock('@/lib/auth-server', () => ({
  auth: { api: { getSession: mocks.authGetSession } },
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/email/invitation-emails', () => ({ sendTeamInvitationEmail: mocks.sendEmail }));

import { createInvitation } from '@/lib/services/admin/invitation-service';

const org = 'org_123';
const actor = 'user_admin';
const roleId = 'role_member';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ toString: () => 'session-cookie' });
  mocks.authGetSession.mockResolvedValue({
    session: { id: 'session' },
    user: { id: actor, email: 'admin@example.test' },
  });
  mocks.requireOrganization.mockResolvedValue({ organizationId: org });
  mocks.requirePermission.mockResolvedValue(undefined);
  mocks.getUserPermissions.mockResolvedValue(new Set(['invitation.create', 'project.read']));
  mocks.roleFindFirst.mockResolvedValue({
    id: roleId,
    name: 'Project reader',
    permissions: [{ permission: { code: 'project.read' } }],
  });
  mocks.userFindFirst.mockResolvedValue(null);
  mocks.invitationUpdateMany.mockResolvedValue({ count: 0 });
  mocks.invitationFindFirst.mockResolvedValue(null);
  mocks.invitationCreate.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'invitation_123',
      email: data.email,
      roleId: data.roleId,
      status: data.status,
      expiresAt: data.expiresAt,
    })
  );
  mocks.organizationFindUniqueOrThrow.mockResolvedValue({ name: 'Agency' });
  mocks.auditCreate.mockResolvedValue({});
  mocks.queryRaw.mockResolvedValue([]);
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({
      $queryRawUnsafe: mocks.queryRaw,
      user: { findFirst: mocks.userFindFirst },
      invitation: {
        updateMany: mocks.invitationUpdateMany,
        findFirst: mocks.invitationFindFirst,
        create: mocks.invitationCreate,
      },
      organization: { findUniqueOrThrow: mocks.organizationFindUniqueOrThrow },
      auditLog: { create: mocks.auditCreate },
    })
  );
  mocks.sendEmail.mockResolvedValue({ status: 'disabled' });
});

describe('createInvitation service boundary', () => {
  it('stores only a token digest, emails the bearer link, and never returns its token', async () => {
    const response = await createInvitation({ email: 'Teammate@example.test', roleId });

    expect(response).toMatchObject({
      id: 'invitation_123',
      email: 'teammate@example.test',
      roleName: 'Project reader',
      status: 'pending',
      emailDelivery: { status: 'disabled' },
    });
    expect(response).not.toHaveProperty('token');
    expect(response).not.toHaveProperty('acceptPath');
    expect(JSON.stringify(response)).not.toMatch(/[a-f0-9]{64}/);

    const invitation = mocks.invitationCreate.mock.calls[0]![0] as {
      data: { tokenHash: string; email: string; roleId: string };
    };
    expect(invitation.data).toMatchObject({ email: 'teammate@example.test', roleId });
    expect(invitation.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: org,
        organizationName: 'Agency',
        to: 'teammate@example.test',
        acceptPath: expect.stringMatching(/^\/invite\/[A-Za-z0-9_-]{40,50}$/),
      })
    );
  });

  it('refuses an invitation role whose permissions exceed the actor grants', async () => {
    mocks.roleFindFirst.mockResolvedValue({
      id: roleId,
      name: 'Administrator',
      permissions: [{ permission: { code: 'user.delete' } }],
    });

    await expect(createInvitation({ email: 'new@example.test', roleId })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
