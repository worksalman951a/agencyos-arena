import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST, DELETE } from '@/app/api/v1/crm/contacts/[id]/portal-access/route';
import {
  getContactPortalAccess,
  inviteContactToPortal,
  revokeContactPortalAccess,
} from '@/lib/services/portal/portal-auth-service';

/**
 * The route is a thin adapter: session validation, the `contact.read` check and
 * the organization scoping all live in the service, so the route is asserted to
 * delegate rather than to reach the database itself. The service-side behaviour
 * (401 / 403 / cross-tenant null) is covered below in its own block.
 */
vi.mock('@/lib/services/portal/portal-auth-service', () => ({
  getContactPortalAccess: vi.fn(),
  inviteContactToPortal: vi.fn(),
  revokeContactPortalAccess: vi.fn(),
}));

describe('Phase 12B: Client Portal Administration Widget API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/crm/contacts/[id]/portal-access', () => {
    it('returns 401 when unauthenticated', async () => {
      vi.mocked(getContactPortalAccess).mockRejectedValue(
        Object.assign(new Error('Unauthenticated'), { statusCode: 401 })
      );

      const res = await GET(
        new Request('http://localhost:3001/api/v1/crm/contacts/c-1/portal-access'),
        {
          params: Promise.resolve({ id: 'c-1' }),
        }
      );

      expect(res.status).toBe(401);
    });

    it('delegates to the authorized service with the requested contact', async () => {
      vi.mocked(getContactPortalAccess).mockResolvedValue({
        portalAccess: {
          id: 'cpa-1',
          email: 'client@company.com',
          status: 'active',
          invitedAt: new Date('2026-11-10'),
          activatedAt: new Date('2026-11-10'),
          revokedAt: null,
          lastLoginAt: new Date('2026-11-11'),
        },
      });

      const res = await GET(
        new Request('http://localhost:3001/api/v1/crm/contacts/c-1/portal-access'),
        {
          params: Promise.resolve({ id: 'c-1' }),
        }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.portalAccess.status).toBe('active');
      expect(getContactPortalAccess).toHaveBeenCalledWith({ contactId: 'c-1' });
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
