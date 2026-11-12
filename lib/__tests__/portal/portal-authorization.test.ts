import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  listClientPortalInvoices,
  getClientPortalInvoice,
  listClientPortalProjects,
  listClientPortalDocuments,
} from '@/lib/services/portal/portal-data-service';
import { getClientPortalSession } from '@/lib/services/portal/portal-auth-service';
import { prisma } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    project: {
      findMany: vi.fn(),
    },
    proposal: {
      findMany: vi.fn(),
    },
    quotation: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/portal/portal-auth-service', () => ({
  getClientPortalSession: vi.fn(),
}));

describe('Phase 11G-1: Client Portal Data Authorization & Scoping', () => {
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

  describe('Invoice Scoping & Entitlements', () => {
    it('queries invoices strictly by organizationId, contactId, non-deleted, and non-draft status', async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        {
          id: 'inv-1',
          number: 'INV-1001',
          title: 'Quarterly Retainer',
          subtotal: { toString: () => '5000.00' },
          tax: { toString: () => '0.00' },
          total: { toString: () => '5000.00' },
          currency: 'USD',
          status: 'sent',
          dueDate: new Date('2026-12-01'),
          createdAt: new Date(),
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.invoice.findMany>>);

      const invoices = await listClientPortalInvoices();

      expect(invoices.length).toBe(1);
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-agency-1',
            clientId: 'c-101',
            deletedAt: null,
            status: { in: ['sent', 'paid', 'overdue'] },
          },
        })
      );
    });

    it('rejects attempt to load invoice belonging to another contact or organization', async () => {
      vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);

      await expect(getClientPortalInvoice('foreign-inv-999')).rejects.toThrow(
        'Invoice not found or access denied'
      );

      expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'foreign-inv-999',
            organizationId: 'org-agency-1',
            clientId: 'c-101',
            deletedAt: null,
            status: { in: ['sent', 'paid', 'overdue'] },
          },
        })
      );
    });
  });

  describe('Projects Scoping', () => {
    it('queries projects strictly by client contactId and filters deleted projects', async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: 'proj-1',
          name: 'Mobile App Redesign',
          description: 'Q4 Redesign deliverable',
          status: 'active',
          startDate: new Date('2026-10-01'),
          endDate: new Date('2026-12-31'),
          createdAt: new Date(),
          milestones: [],
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.project.findMany>>);

      const projects = await listClientPortalProjects();

      expect(projects.length).toBe(1);
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-agency-1',
            clientId: 'c-101',
            deletedAt: null,
          },
        })
      );
    });
  });

  describe('Document Scoping (Proposals & Quotations)', () => {
    it('queries documents strictly by contactId and non-draft statuses', async () => {
      vi.mocked(prisma.proposal.findMany).mockResolvedValue([
        {
          id: 'prop-1',
          number: 'PRP-01',
          title: 'Scope of Work',
          total: { toString: () => '10000.00' },
          currency: 'USD',
          status: 'sent',
          validUntil: new Date('2026-12-01'),
          createdAt: new Date(),
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.proposal.findMany>>);

      vi.mocked(prisma.quotation.findMany).mockResolvedValue([]);

      const docs = await listClientPortalDocuments();

      expect(docs.length).toBe(1);
      expect(docs[0].type).toBe('proposal');
      expect(prisma.proposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-agency-1',
            contactId: 'c-101',
            deletedAt: null,
            status: { in: ['sent', 'accepted', 'rejected'] },
          },
        })
      );
    });
  });
});
