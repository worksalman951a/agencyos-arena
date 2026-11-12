import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createExpense,
  updateExpense,
  getExpense,
  reconcileHistoricalExpenses,
} from '@/lib/services/crm/expense-service';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { requireOrganization, requirePermission } from '@/lib/permissions';

vi.mock('@/lib/db', () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
    expenseItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
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
  requirePermission: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    toString: () => 'mock-session-cookie',
  }),
}));

describe('Phase 11E: Historical Expense Currency Integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 's1', userId: 'u1' },
      user: { id: 'u1', email: 'fin@example.com', role: 'admin' },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);
    vi.mocked(requireOrganization).mockResolvedValue({ organizationId: 'org-fin-1' });
    vi.mocked(requirePermission).mockResolvedValue(undefined);
  });

  describe('Expense Creation with Explicit Currency Persistence', () => {
    it('persists specified transaction currency rather than blindly inheriting default', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        settings: { defaultCurrency: 'USD' },
      } as unknown as Awaited<ReturnType<typeof prisma.organization.findUnique>>);

      vi.mocked(prisma.expenseItem.create).mockResolvedValue({
        id: 'exp-1',
        organizationId: 'org-fin-1',
        projectId: null,
        category: 'Travel & Lodging',
        amount: { toString: () => '450.00' },
        currency: 'EUR',
        expenseDate: new Date('2026-11-10T12:00:00Z'),
        receiptUrl: null,
        billable: true,
        createdAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.expenseItem.create>>);

      const created = await createExpense({
        category: 'Travel & Lodging',
        amount: '450.00',
        currency: 'EUR',
        expenseDate: '2026-11-10T12:00:00Z',
        billable: true,
      });

      expect(prisma.expenseItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: 'EUR',
            amount: 450,
          }),
        })
      );
      expect(created.currency).toBe('EUR');
      expect(created.isHistoricalUnresolved).toBe(false);
    });

    it('defaults to organization default currency when not specified but marks as explicitly persisted', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        settings: { defaultCurrency: 'GBP' },
      } as unknown as Awaited<ReturnType<typeof prisma.organization.findUnique>>);

      vi.mocked(prisma.expenseItem.create).mockResolvedValue({
        id: 'exp-2',
        organizationId: 'org-fin-1',
        projectId: null,
        category: 'Software Subscriptions',
        amount: { toString: () => '120.00' },
        currency: 'GBP',
        expenseDate: new Date('2026-11-10T12:00:00Z'),
        receiptUrl: null,
        billable: false,
        createdAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.expenseItem.create>>);

      const created = await createExpense({
        category: 'Software Subscriptions',
        amount: '120.00',
        expenseDate: '2026-11-10T12:00:00Z',
        billable: false,
      });

      expect(prisma.expenseItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: 'GBP',
          }),
        })
      );
      expect(created.currency).toBe('GBP');
    });
  });

  describe('Historical Unresolved Expenses Handling', () => {
    it('marks legacy row with null currency as isHistoricalUnresolved: true', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        settings: { defaultCurrency: 'USD' },
      } as unknown as Awaited<ReturnType<typeof prisma.organization.findUnique>>);

      vi.mocked(prisma.expenseItem.findFirst).mockResolvedValue({
        id: 'exp-legacy',
        organizationId: 'org-fin-1',
        projectId: null,
        category: 'Office Supplies',
        amount: { toString: () => '25.00' },
        currency: null, // Legacy row before migration
        expenseDate: new Date('2025-05-15T12:00:00Z'),
        receiptUrl: null,
        billable: false,
        createdAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.expenseItem.findFirst>>);

      const expense = await getExpense('exp-legacy');
      expect(expense.isHistoricalUnresolved).toBe(true);
      expect(expense.currency).toBe('USD'); // Visual fallback to current default
    });

    it('updating legacy expense without changing currency does not overwrite existing currency state', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        settings: { defaultCurrency: 'USD' },
      } as unknown as Awaited<ReturnType<typeof prisma.organization.findUnique>>);

      vi.mocked(prisma.expenseItem.findFirst).mockResolvedValue({
        id: 'exp-legacy',
        organizationId: 'org-fin-1',
        projectId: null,
        category: 'Office Supplies',
        amount: { toString: () => '25.00' },
        currency: null,
        expenseDate: new Date('2025-05-15T12:00:00Z'),
        receiptUrl: null,
        billable: false,
        createdAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.expenseItem.findFirst>>);

      vi.mocked(prisma.expenseItem.update).mockResolvedValue({
        id: 'exp-legacy',
        organizationId: 'org-fin-1',
        projectId: null,
        category: 'Office Equipment',
        amount: { toString: () => '30.00' },
        currency: null,
        expenseDate: new Date('2025-05-15T12:00:00Z'),
        receiptUrl: null,
        billable: false,
        createdAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.expenseItem.update>>);

      await updateExpense('exp-legacy', {
        category: 'Office Equipment',
        amount: '30.00',
      });

      expect(prisma.expenseItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: null,
            category: 'Office Equipment',
          }),
        })
      );
    });

    it('rejects attempt to alter verified currency during ordinary expense update', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        settings: { defaultCurrency: 'USD' },
      } as unknown as Awaited<ReturnType<typeof prisma.organization.findUnique>>);

      vi.mocked(prisma.expenseItem.findFirst).mockResolvedValue({
        id: 'exp-verified',
        organizationId: 'org-fin-1',
        projectId: null,
        category: 'Travel',
        amount: { toString: () => '100.00' },
        currency: 'EUR',
        expenseDate: new Date('2026-10-01T12:00:00Z'),
        receiptUrl: null,
        billable: true,
        createdAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof prisma.expenseItem.findFirst>>);

      await expect(
        updateExpense('exp-verified', {
          currency: 'GBP',
          amount: '100.00',
        })
      ).rejects.toThrow('Expense currency is immutable once recorded (EUR)');
    });
  });

  describe('Authoritative Historical Reconciliation Workflow', () => {
    it('allows authorized admin to reconcile historical expenses with verified currency and audit trail', async () => {
      vi.mocked(prisma.expenseItem.findMany).mockResolvedValue([
        { id: 'exp-legacy-1', organizationId: 'org-fin-1', currency: null },
        { id: 'exp-legacy-2', organizationId: 'org-fin-1', currency: null },
      ] as unknown as Awaited<ReturnType<typeof prisma.expenseItem.findMany>>);

      vi.mocked(prisma.expenseItem.updateMany).mockResolvedValue({ count: 2 });

      const res = await reconcileHistoricalExpenses({
        expenseIds: ['exp-legacy-1', 'exp-legacy-2'],
        currency: 'EUR',
      });

      expect(res.reconciledCount).toBe(2);
      expect(res.currency).toBe('EUR');
      expect(prisma.expenseItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: ['exp-legacy-1', 'exp-legacy-2'] },
            organizationId: 'org-fin-1',
          },
          data: expect.objectContaining({
            currency: 'EUR',
            reconciledBy: 'u1',
          }),
        })
      );

      // Verify audit log entry
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'expense.currency.reconcile',
            organizationId: 'org-fin-1',
            metadata: expect.objectContaining({
              assignedCurrency: 'EUR',
              reconciledCount: 2,
            }),
          }),
        })
      );
    });

    it('skips already-verified expenses unless allowOverwrite is explicitly specified with reason', async () => {
      vi.mocked(prisma.expenseItem.findMany).mockResolvedValue([
        { id: 'exp-verified', organizationId: 'org-fin-1', currency: 'USD' },
      ] as unknown as Awaited<ReturnType<typeof prisma.expenseItem.findMany>>);

      await expect(
        reconcileHistoricalExpenses({
          expenseIds: ['exp-verified'],
          currency: 'EUR',
        })
      ).rejects.toThrow('Selected expenses already have verified currencies');
    });

    it('rejects verified currency overwrite if caller is not an administrator', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: { id: 's1', userId: 'u2' },
        user: { id: 'u2', email: 'staff@example.com', role: 'member' },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

      await expect(
        reconcileHistoricalExpenses({
          expenseIds: ['exp-verified'],
          currency: 'EUR',
          allowOverwrite: true,
          reason: 'Correcting errant currency assignment',
        })
      ).rejects.toThrow(
        'Overwriting previously verified expense currencies requires organization administrator authority'
      );
    });

    it('rejects verified currency overwrite if explicit justification is missing', async () => {
      vi.mocked(prisma.expenseItem.findMany).mockResolvedValue([
        { id: 'exp-verified', organizationId: 'org-fin-1', currency: 'USD' },
      ] as unknown as Awaited<ReturnType<typeof prisma.expenseItem.findMany>>);

      await expect(
        reconcileHistoricalExpenses({
          expenseIds: ['exp-verified'],
          currency: 'EUR',
          allowOverwrite: true,
        })
      ).rejects.toThrow('An explicit justification reason is required');
    });

    it('allows administrator to overwrite verified currency when justified, capturing audit trail', async () => {
      vi.mocked(prisma.expenseItem.findMany).mockResolvedValue([
        { id: 'exp-verified', organizationId: 'org-fin-1', currency: 'USD' },
      ] as unknown as Awaited<ReturnType<typeof prisma.expenseItem.findMany>>);

      vi.mocked(prisma.expenseItem.updateMany).mockResolvedValue({ count: 1 });

      const res = await reconcileHistoricalExpenses({
        expenseIds: ['exp-verified'],
        currency: 'EUR',
        allowOverwrite: true,
        reason: 'Invoice audit showed billing was actually EUR',
      });

      expect(res.reconciledCount).toBe(1);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'expense.currency.reconcile',
            metadata: expect.objectContaining({
              allowOverwrite: true,
              reason: 'Invoice audit showed billing was actually EUR',
              previousCurrencies: [{ id: 'exp-verified', previousCurrency: 'USD' }],
            }),
          }),
        })
      );
    });

    it('rejects cross-tenant reconciliation attempts', async () => {
      vi.mocked(prisma.expenseItem.findMany).mockResolvedValue([]);

      await expect(
        reconcileHistoricalExpenses({
          expenseIds: ['foreign-exp-1'],
          currency: 'USD',
        })
      ).rejects.toThrow('No matching expenses found in organization');
    });
  });
});
