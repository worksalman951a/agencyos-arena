import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST, DELETE } from '@/app/api/v1/crm/contacts/[id]/portal-access/route';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { requireOrganization } from '@/lib/permissions';
import {
  inviteContactToPortal,
  revokeContactPortalAccess,
} from '@/lib/services/portal/portal-auth-service';

vi.mock('@/lib/db', () => ({
  prisma: {
    clientPortalAccess: {
      findUnique: vi.fn(),
    },
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
}));

vi.mock('@/lib/services/portal/portal-auth-service', () => ({
  inviteContactToPortal: vi.fn(),
  revokeContactPortalAccess: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    toString: () => 'mock-cookie',
  }),
}));

describe('Phase 12B: Client Portal Administration Widget API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/crm/contacts/[id]/portal-access', () => {
    it('returns 401 when unauthenticated', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(
        null as unknown as Awaited<ReturnType<typeof auth.api.getSession>>
      );

      const res = await GET(
        new Request('http://localhost:3001/api/v1/crm/contacts/c-1/portal-access'),
        {
          params: Promise.resolve({ id: 'c-1' }),
        }
      );

      expect(res.status).toBe(401);
    });

    it('returns portal access state for authenticated organization admin', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: { id: 's1', userId: 'u-1' },
        user: { id: 'u-1', email: 'admin@agency.com', role: 'admin' },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);
      vi.mocked(requireOrganization).mockResolvedValue({ organizationId: 'org-1' });
      vi.mocked(prisma.clientPortalAccess.findUnique).mockResolvedValue({
        id: 'cpa-1',
        email: 'client@company.com',
        status: 'active',
        invitedAt: new Date('2026-11-10'),
        activatedAt: new Date('2026-11-10'),
        revokedAt: null,
        lastLoginAt: new Date('2026-11-11'),
      } as unknown as Awaited<ReturnType<typeof prisma.clientPortalAccess.findUnique>>);

      const res = await GET(
        new Request('http://localhost:3001/api/v1/crm/contacts/c-1/portal-access'),
        {
          params: Promise.resolve({ id: 'c-1' }),
        }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.portalAccess.status).toBe('active');
      expect(prisma.clientPortalAccess.findUnique).toHaveBeenCalledWith({
        where: { organizationId_contactId: { organizationId: 'org-1', contactId: 'c-1' } },
        select: expect.any(Object),
      });
    });
  });

  describe('POST /api/v1/crm/contacts/[id]/portal-access', () => {
    it('calls inviteContactToPortal and returns result', async () => {
      vi.mocked(inviteContactToPortal).mockResolvedValue({
        portalAccessId: 'cpa-1',
        contactId: 'c-1',
        email: 'client@company.com',
        status: 'pending',
        invitationUrl: '/portal/login#token=xxx',
        rawTokenForTesting: undefined,
      });

      const req = new Request('http://localhost:3001/api/v1/crm/contacts/c-1/portal-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'client@company.com' }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: 'c-1' }) });
      expect(res.status).toBe(200);
      expect(inviteContactToPortal).toHaveBeenCalledWith({
        contactId: 'c-1',
        email: 'client@company.com',
      });
    });

    it('returns error status if user is non-admin', async () => {
      vi.mocked(inviteContactToPortal).mockRejectedValue(
        Object.assign(
          new Error('Only organization administrators can grant client portal access'),
          {
            statusCode: 403,
          }
        )
      );

      const req = new Request('http://localhost:3001/api/v1/crm/contacts/c-1/portal-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'client@company.com' }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: 'c-1' }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Only organization administrators can grant client portal access');
    });
  });

  describe('DELETE /api/v1/crm/contacts/[id]/portal-access', () => {
    it('calls revokeContactPortalAccess and returns result', async () => {
      vi.mocked(revokeContactPortalAccess).mockResolvedValue({
        success: true,
        status: 'revoked',
      });

      const req = new Request('http://localhost:3001/api/v1/crm/contacts/c-1/portal-access', {
        method: 'DELETE',
      });

      const res = await DELETE(req, { params: Promise.resolve({ id: 'c-1' }) });
      expect(res.status).toBe(200);
      expect(revokeContactPortalAccess).toHaveBeenCalledWith({ contactId: 'c-1' });
    });
  });
});
