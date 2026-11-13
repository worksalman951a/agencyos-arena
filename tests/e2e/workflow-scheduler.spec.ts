import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';

import { APP_URL, expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

type TestDb = {
  user: {
    findUnique(args: unknown): Promise<{ id: string; organizationId: string | null } | null>;
  };
  invoice: {
    create(args: unknown): Promise<{ id: string; number: string }>;
    findUniqueOrThrow(args: unknown): Promise<Record<string, unknown>>;
  };
  payment: {
    create(args: unknown): Promise<{ id: string }>;
    findMany(args: unknown): Promise<Array<{ id: string; amount: { toString(): string } }>>;
  };
  workflowExecution: {
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<{ id: string; attempts: number }>;
    findUniqueOrThrow(args: unknown): Promise<Record<string, unknown>>;
  };
  auditLog: { count(args: unknown): Promise<number> };
  $disconnect(): Promise<void>;
};

const require = createRequire(`${process.cwd()}/package.json`);
const { PrismaClient } = require('@prisma/client') as {
  PrismaClient: new (options: { adapter: unknown }) => TestDb;
};

const authHeaders = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
  Origin: APP_URL,
  Accept: 'application/json',
  'Content-Type': 'application/json',
});

test.describe('workflow scheduler', () => {
  test('protects the scheduler endpoint, deduplicates concurrent overdue invoice runs and preserves finance data', async ({
    api,
    account,
  }) => {
    const secret = process.env.WORKFLOW_SCHEDULER_SECRET;
    test.skip(!secret, 'E2E scheduler secret is not configured');
    if (!secret) return;

    const db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    });
    try {
      const user = await db.user.findUnique({
        where: { email: account.email },
        select: { id: true, organizationId: true },
      });
      expect(user?.organizationId).toBeTruthy();
      const ruleResponse = await api.post('/api/v1/automation/workflows', {
        headers: authHeaders(account),
        data: {
          name: `E2E invoice overdue ${randomUUID()}`,
          trigger: 'invoice.overdue',
          conditions: {},
          actions: {
            list: [
              { type: 'log', message: 'already completed' },
              { type: 'log', message: 'safe retry' },
            ],
          },
          enabled: true,
        },
      });
      expect(ruleResponse.status()).toBe(201);
      const rule = (await ruleResponse.json()) as { id: string };

      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const dueDate = new Date(
        Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), 12)
      );
      const invoice = (await db.invoice.create({
        data: {
          organizationId: user!.organizationId,
          number: `E2E-SCHED-${randomUUID()}`,
          title: 'Scheduler may only mark this invoice overdue',
          status: 'sent',
          subtotal: '125.00',
          tax: '12.50',
          total: '137.50',
          currency: 'USD',
          dueDate,
        },
      })) as { id: string; number: string };
      await db.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: '25.00',
          method: 'bank_transfer',
          paidAt: new Date(),
        },
      });
      const before = await db.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        select: { status: true, subtotal: true, tax: true, total: true, dueDate: true },
      });
      const paymentsBefore = (
        await db.payment.findMany({
          where: { invoiceId: invoice.id },
          select: { id: true, amount: true },
        })
      ).map((payment) => ({ id: payment.id, amount: payment.amount.toString() }));

      const unauthorized = await api.post('/api/internal/automation/scheduler');
      expect(unauthorized.status()).toBe(401);
      expect(await db.workflowExecution.count({ where: { ruleId: rule.id } })).toBe(0);

      const invoke = () =>
        api.post('/api/internal/automation/scheduler', {
          headers: { Authorization: `Bearer ${secret}` },
        });
      const [first, concurrent] = await Promise.all([invoke(), invoke()]);
      expect(first.status(), await first.text()).toBe(200);
      expect(concurrent.status(), await concurrent.text()).toBe(200);
      const operational = (await first.json()) as {
        monitoring: { pending: number; running: number; failed: number; terminal: number };
        recovery: {
          scanned: number;
          retried: number;
          quarantined: number;
          terminal: number;
          failed: number;
        };
      };
      expect(operational.monitoring).toEqual(
        expect.objectContaining({
          pending: expect.any(Number),
          running: expect.any(Number),
          failed: expect.any(Number),
          terminal: expect.any(Number),
        })
      );
      expect(operational.recovery).toEqual(
        expect.objectContaining({ scanned: expect.any(Number) })
      );

      const historyResponse = await api.get(`/api/v1/automation/workflows/${rule.id}/executions`, {
        headers: authHeaders(account),
      });
      expect(historyResponse.status()).toBe(200);
      const history = (await historyResponse.json()) as Array<{
        id: string;
        recordId: string;
        status: string;
        resultLog: Record<string, unknown>;
      }>;
      const invoiceExecutions = history.filter((entry) => entry.recordId === invoice.id);
      expect(invoiceExecutions).toHaveLength(1);
      expect(invoiceExecutions[0]).toMatchObject({
        status: 'succeeded',
        resultLog: { source: 'scheduler', eventType: 'invoice.overdue' },
      });
      expect(
        await db.workflowExecution.count({
          where: { ruleId: rule.id, recordType: 'Invoice', recordId: invoice.id },
        })
      ).toBe(1);
      expect(
        await db.auditLog.count({
          where: {
            organizationId: user!.organizationId,
            action: 'workflow.scheduled_execution',
            entityType: 'WorkflowExecution',
            entityId: invoiceExecutions[0].id,
          },
        })
      ).toBe(1);

      const after = await db.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        select: { status: true, subtotal: true, tax: true, total: true, dueDate: true },
      });
      expect(after).toEqual({ ...before, status: 'overdue' });
      expect(
        (
          await db.payment.findMany({
            where: { invoiceId: invoice.id },
            select: { id: true, amount: true },
          })
        ).map((payment) => ({ id: payment.id, amount: payment.amount.toString() }))
      ).toEqual(paymentsBefore);

      const staleExecution = await db.workflowExecution.create({
        data: {
          organizationId: user!.organizationId,
          ruleId: rule.id,
          recordType: 'Invoice',
          recordId: invoice.id,
          status: 'running',
          dedupeKey: `e2e-stale-${randomUUID()}`,
          attempts: 1,
          lastAttemptAt: new Date(Date.now() - 20 * 60_000),
          claimToken: 'expired-e2e-worker',
          resultLog: {
            actorId: user!.id,
            source: 'scheduler',
            eventType: 'invoice.overdue',
            eventVersion: 'e2e-stale-recovery',
            actionDefinitions: {
              list: [
                { type: 'log', message: 'already completed' },
                { type: 'log', message: 'safe retry' },
              ],
            },
            actions: [{ index: 0, type: 'log', status: 'ok', detail: 'already persisted' }],
          },
        },
      });
      const recoveryResponse = await invoke();
      expect(recoveryResponse.status(), await recoveryResponse.text()).toBe(200);
      const recovered = await db.workflowExecution.findUniqueOrThrow({
        where: { id: staleExecution.id },
      });
      expect(recovered).toMatchObject({
        status: 'succeeded',
        attempts: 2,
        claimToken: null,
        resultLog: {
          actions: [
            { index: 0, status: 'ok', detail: 'already completed' },
            { index: 1, status: 'ok' },
          ],
        },
      });
    } finally {
      await db.$disconnect();
    }
  });
});
