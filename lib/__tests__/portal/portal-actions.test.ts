import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  executePortalProposalAction,
  executePortalContractAction,
} from '@/lib/services/portal/portal-action-service';
import { getClientPortalSession } from '@/lib/services/portal/portal-auth-service';
import { prisma } from '@/lib/db';
import { createNotification } from '@/lib/services/automation/notification-service';

vi.mock('@/lib/db', () => ({
  prisma: {
    proposal: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    quotation: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    contract: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    signature: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback(prisma);
      }
      return Promise.all(callback);
    }),
  },
}));

vi.mock('@/lib/services/portal/portal-auth-service', () => ({
  getClientPortalSession: vi.fn(),
}));

vi.mock('@/lib/services/automation/notification-service', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

describe('Phase 11G-2: Client Portal Approvals & Contract Acceptance', () => {
  const mockUpdatedAt = new Date('2026-11-10T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientPortalSession).mockResolvedValue({
      portalAccessId: 'cpa-1',
      organizationId: 'org-agency-1',
      contactId: 'c-101',
      email: 'client@company.com',
      contactName: 'Alice Client',
      accountId: 'acc-1',
      accountName: 'Acme Corp',
      organizationName: 'Studio Agency',
      organizationBrand: { brandName: 'Studio Agency', brandColor: '#047857', logoUrl: null },
    });
  });

  describe('Proposal Acceptance & Rejection with Mandatory Version Binding', () => {
    it('accepts sent proposal with matching expectedVersion, updates status, and logs audit trail', async () => {
      vi.mocked(prisma.proposal.findFirst).mockResolvedValue({
        id: 'prop-1',
        number: 'PRP-101',
        title: 'Branding Campaign',
        status: 'sent',
        organizationId: 'org-agency-1',
        contactId: 'c-101',
        createdBy: 'user-admin-1',
        updatedAt: mockUpdatedAt,
      } as unknown as Awaited<ReturnType<typeof prisma.proposal.findFirst>>);

      vi.mocked(prisma.proposal.updateMany).mockResolvedValue({
        count: 1,
      });

      const result = await executePortalProposalAction({
        documentId: 'prop-1',
        documentType: 'proposal',
        action: 'accept',
        expectedVersion: mockUpdatedAt.toISOString(),
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('accepted');
      expect(prisma.proposal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'prop-1',
            status: 'sent',
            updatedAt: mockUpdatedAt,
          }),
          data: expect.objectContaining({ status: 'accepted' }),
        })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'portal.proposal.accept',
            entityId: 'prop-1',
            organizationId: 'org-agency-1',
          }),
        })
      );
      expect(createNotification).toHaveBeenCalled();
    });

    it('rejects proposal action when expectedVersion does not match current version (stale version 409)', async () => {
      vi.mocked(prisma.proposal.findFirst).mockResolvedValue({
        id: 'prop-1',
        status: 'sent',
        organizationId: 'org-agency-1',
        contactId: 'c-101',
        updatedAt: new Date('2026-11-11T15:00:00.000Z'),
      } as unknown as Awaited<ReturnType<typeof prisma.proposal.findFirst>>);

      await expect(
        executePortalProposalAction({
          documentId: 'prop-1',
          documentType: 'proposal',
          action: 'accept',
          expectedVersion: '2026-11-10T12:00:00.000Z',
        })
      ).rejects.toThrow('Document version has changed. Please review the latest document terms.');
    });

    it('rejects proposal action on cross-contact proposal', async () => {
      vi.mocked(prisma.proposal.findFirst).mockResolvedValue(null);

      await expect(
        executePortalProposalAction({
          documentId: 'foreign-prop-999',
          documentType: 'proposal',
          action: 'accept',
          expectedVersion: mockUpdatedAt.toISOString(),
        })
      ).rejects.toThrow('Proposal not found or access denied');
    });

    it('rejects action on draft or non-sent proposal', async () => {
      vi.mocked(prisma.proposal.findFirst).mockResolvedValue({
        id: 'prop-1',
        status: 'draft',
        organizationId: 'org-agency-1',
        contactId: 'c-101',
        updatedAt: mockUpdatedAt,
      } as unknown as Awaited<ReturnType<typeof prisma.proposal.findFirst>>);

      await expect(
        executePortalProposalAction({
          documentId: 'prop-1',
          documentType: 'proposal',
          action: 'accept',
          expectedVersion: mockUpdatedAt.toISOString(),
        })
      ).rejects.toThrow("Cannot accept proposal in status 'draft'");
    });

    it('returns idempotently if proposal is already in target status', async () => {
      vi.mocked(prisma.proposal.findFirst).mockResolvedValue({
        id: 'prop-1',
        status: 'accepted',
        organizationId: 'org-agency-1',
        contactId: 'c-101',
        updatedAt: mockUpdatedAt,
      } as unknown as Awaited<ReturnType<typeof prisma.proposal.findFirst>>);

      const result = await executePortalProposalAction({
        documentId: 'prop-1',
        documentType: 'proposal',
        action: 'accept',
        expectedVersion: mockUpdatedAt.toISOString(),
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('accepted');
      expect(prisma.proposal.updateMany).not.toHaveBeenCalled();
    });

    it('throws 409 conflict when conditional update matches 0 rows (competing concurrent transition)', async () => {
      vi.mocked(prisma.proposal.findFirst).mockResolvedValue({
        id: 'prop-1',
        status: 'sent',
        organizationId: 'org-agency-1',
        contactId: 'c-101',
        updatedAt: mockUpdatedAt,
      } as unknown as Awaited<ReturnType<typeof prisma.proposal.findFirst>>);

      vi.mocked(prisma.proposal.updateMany).mockResolvedValue({
        count: 0,
      });

      await expect(
        executePortalProposalAction({
          documentId: 'prop-1',
          documentType: 'proposal',
          action: 'accept',
          expectedVersion: mockUpdatedAt.toISOString(),
        })
      ).rejects.toThrow('Document was modified or processed concurrently by another request');
    });
  });

  describe('Contract Electronic Acceptance with Mandatory Version Binding', () => {
    it('electronically signs contract with audit trail when consent and matching version are provided', async () => {
      vi.mocked(prisma.contract.findFirst).mockResolvedValue({
        id: 'ctr-1',
        title: 'Master Service Agreement',
        status: 'draft',
        organizationId: 'org-agency-1',
        proposal: { contactId: 'c-101' },
        updatedAt: mockUpdatedAt,
      } as unknown as Awaited<ReturnType<typeof prisma.contract.findFirst>>);

      vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 1 });

      const result = await executePortalContractAction(
        {
          documentId: 'ctr-1',
          documentType: 'contract',
          action: 'accept',
          expectedVersion: mockUpdatedAt.toISOString(),
          signerName: 'Alice Client',
          signerEmail: 'client@company.com',
          consentGiven: true,
        },
        { ipAddress: '192.168.1.5', userAgent: 'Mozilla/5.0' }
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('signed');
      expect(prisma.signature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractId: 'ctr-1',
            signerName: 'Alice Client',
            signerEmail: 'client@company.com',
            signatureMethod: 'audit_trail',
            ipAddress: '192.168.1.5',
          }),
        })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'portal.contract.accept',
            entityId: 'ctr-1',
          }),
        })
      );
    });

    it('rejects contract acceptance when expectedVersion is stale', async () => {
      vi.mocked(prisma.contract.findFirst).mockResolvedValue({
        id: 'ctr-1',
        status: 'draft',
        organizationId: 'org-agency-1',
        proposal: { contactId: 'c-101' },
        updatedAt: new Date('2026-11-11T16:00:00.000Z'),
      } as unknown as Awaited<ReturnType<typeof prisma.contract.findFirst>>);

      await expect(
        executePortalContractAction({
          documentId: 'ctr-1',
          documentType: 'contract',
          action: 'accept',
          expectedVersion: '2026-11-10T12:00:00.000Z',
          consentGiven: true,
        })
      ).rejects.toThrow('Contract terms have been updated. Please review the updated agreement.');
    });

    it('rejects contract acceptance without explicit consent', async () => {
      vi.mocked(prisma.contract.findFirst).mockResolvedValue({
        id: 'ctr-1',
        status: 'draft',
        organizationId: 'org-agency-1',
        proposal: { contactId: 'c-101' },
        updatedAt: mockUpdatedAt,
      } as unknown as Awaited<ReturnType<typeof prisma.contract.findFirst>>);

      await expect(
        executePortalContractAction({
          documentId: 'ctr-1',
          documentType: 'contract',
          action: 'accept',
          expectedVersion: mockUpdatedAt.toISOString(),
          consentGiven: false,
        })
      ).rejects.toThrow('Explicit legal acceptance consent is required.');
    });

    it('rejects acceptance of voided contracts', async () => {
      vi.mocked(prisma.contract.findFirst).mockResolvedValue({
        id: 'ctr-1',
        status: 'voided',
        organizationId: 'org-agency-1',
        proposal: { contactId: 'c-101' },
        updatedAt: mockUpdatedAt,
      } as unknown as Awaited<ReturnType<typeof prisma.contract.findFirst>>);

      await expect(
        executePortalContractAction({
          documentId: 'ctr-1',
          documentType: 'contract',
          action: 'accept',
          expectedVersion: mockUpdatedAt.toISOString(),
          consentGiven: true,
        })
      ).rejects.toThrow('Cannot accept a voided contract');
    });
  });
});
