import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cookies } from 'next/headers';
import {
  inviteContactToPortal,
  revokeContactPortalAccess,
  verifyPortalTokenAndLogin,
  getClientPortalSession,
  PORTAL_SESSION_COOKIE,
} from '@/lib/services/portal/portal-auth-service';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { requireOrganization, requirePermission } from '@/lib/permissions';

vi.mock('@/lib/db', () => ({
  prisma: {
    contact: {
      findFirst: vi.fn(),
    },
    clientPortalAccess: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    clientPortalSession: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation((promises) => Promise.all(promises)),
  },
}));

vi.mock('@/lib/auth-server', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('@/lib/permissions', () => ({
  requireOrganization: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock('next/headers', () => {
  const store = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    toString: () => 'mock-cookie',
  };
  return {
    cookies: vi.fn().mockResolvedValue(store),
    __mockCookieStore: store,
  };
});

describe('Phase 11G-1: Client Portal Foundation & Authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 's1', userId: 'admin-1' },
      user: { id: 'admin-1', email: 'admin@agency.com', role: 'admin' },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);
    vi.mocked(requireOrganization).mockResolvedValue({ organizationId: 'org-agency-1' });
    vi.mocked(requirePermission).mockResolvedValue(undefined);
  });

  describe('Explicit Admin Provisioning', () => {
    it('creates pending portal access and generates single-use hashed invitation token', async () => {
      vi.mocked(prisma.contact.findFirst).mockResolvedValue({
        id: 'c-101',
        organizationId: 'org-agency-1',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@client.com',
        account: { id: 'acc-1', organizationId: 'org-agency-1' },
      } as unknown as Awaited<ReturnType<typeof prisma.contact.findFirst>>);

      vi.mocked(prisma.clientPortalAccess.upsert).mockResolvedValue({
        id: 'cpa-1',
        organizationId: 'org-agency-1',
        contactId: 'c-101',
        email: 'alice@client.com',
        status: 'pending',
      } as unknown as Awaited<ReturnType<typeof prisma.clientPortalAccess.upsert>>);

      const res = await inviteContactToPortal({
        contactId: 'c-101',
        email: 'alice@client.com',
      });

      expect(res.portalAccessId).toBe('cpa-1');
      expect(res.status).toBe('pending');
      expect(res.rawTokenForTesting).toBeDefined();
      expect(prisma.clientPortalAccess.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            contactId: 'c-101',
            status: 'pending',
          }),
        })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'portal.access.invite',
            organizationId: 'org-agency-1',
          }),
        })
      );
    });

    it('rejects cross-tenant contact invitation attempts', async () => {
      vi.mocked(prisma.contact.findFirst).mockResolvedValue(null);

      await expect(
        inviteContactToPortal({
          contactId: 'foreign-c-999',
          email: 'foreign@other.com',
        })
      ).rejects.toThrow('Contact not found in organization');
    });

    it('rejects invitation attempts from non-admin/non-owner CRM editors', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: { id: 's2', userId: 'editor-1' },
        user: { id: 'editor-1', email: 'editor@agency.com', role: 'member' },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

      await expect(
        inviteContactToPortal({
          contactId: 'c-101',
          email: 'alice@client.com',
        })
      ).rejects.toThrow('Only organization administrators can grant client portal access');
    });

    it('rejects revocation attempts from non-admin/non-owner CRM editors', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: { id: 's2', userId: 'editor-1' },
        user: { id: 'editor-1', email: 'editor@agency.com', role: 'member' },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

      await expect(
        revokeContactPortalAccess({
          contactId: 'c-101',
        })
      ).rejects.toThrow('Only organization administrators can revoke client portal access');
    });
  });

  describe('Token Verification & Activation', () => {
    it('activates pending account upon valid invitation token verification and establishes session', async () => {
      const token = '1234567890abcdef1234567890abcdef';
      vi.mocked(prisma.clientPortalAccess.findFirst).mockResolvedValue({
        id: 'cpa-1',
        organizationId: 'org-agency-1',
        contactId: 'c-101',
        email: 'alice@client.com',
        status: 'pending',
        invitationHash: 'mock-hash',
        contact: { id: 'c-101', firstName: 'Alice', lastName: 'Smith' },
        organization: { id: 'org-agency-1', name: 'Acme Agency' },
      } as unknown as Awaited<ReturnType<typeof prisma.clientPortalAccess.findFirst>>);

      vi.mocked(prisma.clientPortalAccess.update).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof prisma.clientPortalAccess.update>>
      );
      vi.mocked(prisma.clientPortalSession.create).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof prisma.clientPortalSession.create>>
      );

      const loginResult = await verifyPortalTokenAndLogin({ token });

      expect(loginResult.success).toBe(true);
      expect(prisma.clientPortalAccess.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cpa-1' },
          data: expect.objectContaining({ status: 'active' }),
        })
      );
      const cookieStore = await cookies();
      expect(cookieStore.set).toHaveBeenCalledWith(
        PORTAL_SESSION_COOKIE,
        expect.any(String),
        expect.objectContaining({ httpOnly: true })
      );
    });

    it('rejects expired or manipulated tokens', async () => {
      vi.mocked(prisma.clientPortalAccess.findFirst).mockResolvedValue(null);

      await expect(
        verifyPortalTokenAndLogin({ token: 'invalid-or-expired-token-12345678' })
      ).rejects.toThrow('Invalid or expired login link');
    });
  });

  describe('Account Revocation & Session Invalidation', () => {
    it('revokes access and invalidates all active sessions for that contact', async () => {
      vi.mocked(prisma.clientPortalAccess.findUnique).mockResolvedValue({
        id: 'cpa-1',
        organizationId: 'org-agency-1',
        contactId: 'c-101',
      } as unknown as Awaited<ReturnType<typeof prisma.clientPortalAccess.findUnique>>);

      const res = await revokeContactPortalAccess({
        contactId: 'c-101',
        reason: 'Client contract concluded',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('revoked');
      expect(prisma.clientPortalAccess.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cpa-1' },
          data: expect.objectContaining({ status: 'revoked' }),
        })
      );
      expect(prisma.clientPortalSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { portalAccessId: 'cpa-1', revokedAt: null },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        })
      );
    });
  });

  describe('Session Retrieval & Isolation', () => {
    it('rejects session if portal access is revoked', async () => {
      const cookieStore = await cookies();
      vi.mocked(cookieStore.get).mockReturnValue({
        value: 'mock-session-token',
      } as unknown as ReturnType<typeof cookieStore.get>);

      vi.mocked(prisma.clientPortalSession.findUnique).mockResolvedValue({
        id: 'sess-1',
        sessionHash: 'mock-hash',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null,
        portalAccess: {
          id: 'cpa-1',
          status: 'revoked', // Revoked
          contact: { id: 'c-101' },
          organization: { id: 'org-1' },
        },
      } as unknown as Awaited<ReturnType<typeof prisma.clientPortalSession.findUnique>>);

      await expect(getClientPortalSession()).rejects.toThrow('Portal access inactive or revoked');
    });
  });
});
