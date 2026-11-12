// @vitest-environment node
/**
 * Integration: Phase 5B-1 TimeEntry project linking, billing rates, ownership,
 * and multi-currency project summaries (real PostgreSQL + HTTP).
 *
 * Covers:
 *   1. Billable time entry linked directly to a project (explicit & default currency)
 *   2. Non-billable entry with null/ignored billing fields
 *   3. Task-linked entry deriving projectId, task/project mismatch rejection, and
 *      task deletion retaining projectId
 *   4. Missing permission rejection (403)
 *   5. Non-admin user attempting to log/modify/delete another user's entry (403)
 *      vs. Administrator (200/201)
 *   6. Cross-organization isolation at HTTP, service, and PostgreSQL FK layers
 *   7. Archived (400) and soft-deleted (404) project time-entry restrictions
 *   8. Billable toggle, rate/currency snapshotting & immutability on partial updates
 *   9. Project-level time listing & multi-currency summary accuracy without
 *      impacting invoice totals, numbering, or payments
 *  10. Migration 0022 backfill / NO ACTION / org cascade / rollback verification
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import {
  authHeaders,
  cleanupOrganizations,
  createBootstrappedAccount,
  createMemberWithPermissions,
  createOrganizationWithAdmin,
  jsonFetch,
  type TestAccount,
} from './batch4-provisioning';
import { SERVER_URL } from './test-config';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const FK_NAME = 'TimeEntry_projectId_organizationId_fkey';

interface TimeEntryBody {
  id: string;
  organizationId: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  hours: string;
  description: string | null;
  billable: boolean;
  hourlyRate: string | null;
  currency: string | null;
  billableAmount: string | null;
  project: { id: string; name: string; status: string; deleted: boolean } | null;
  task: { id: string; title: string; projectId: string } | null;
}

interface TimeEntrySummaryBody {
  entryCount: number;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  ratedBillableEntryCount: number;
  unratedBillableEntryCount: number;
  unratedBillableHours: number;
  billableAmountsByCurrency: Array<{
    currency: string;
    amount: string;
    amountMinor: number;
    billableHours: number;
    entryCount: number;
  }>;
}

describeIfDb('TimeEntry project linking and billing (real PostgreSQL)', () => {
  const createdOrganizations: string[] = [];

  let admin: TestAccount;
  let memberA: TestAccount; // time.entry.* + project.read (non-admin)
  let memberB: TestAccount; // time.entry.* (non-admin)
  let projectOnly: TestAccount; // project.read only (no time.entry.*)
  let foreignAdmin: TestAccount; // distinct organization

  let projectActive = '';
  let projectOther = '';
  let projectArchived = '';
  let projectDeleted = '';
  let foreignProject = '';
  let taskOnActive = '';
  let taskOnOther = '';
  let taskOnArchived = '';

  const api = (
    account: TestAccount | null,
    path: string,
    init: { method?: string; body?: unknown } = {}
  ) =>
    jsonFetch(path, {
      method: init.method ?? 'GET',
      headers: account
        ? authHeaders(account.token)
        : { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  const createProject = async (account: TestAccount, name: string, status = 'active') => {
    const res = await api(account, '/api/v1/crm/projects', {
      method: 'POST',
      body: { name, status },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { id: string }).id;
  };

  const createTask = async (account: TestAccount, projectId: string, title: string) => {
    const res = await api(account, `/api/v1/crm/projects/${projectId}/tasks`, {
      method: 'POST',
      body: { title },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { id: string }).id;
  };

  beforeAll(async () => {
    admin = await createBootstrappedAccount('phase5b-time-admin');
    createdOrganizations.push(admin.organizationId);

    // Configure org A defaultCurrency to EUR to test org-default resolution + snapshot immutability
    const orgRes = await api(admin, '/api/v1/settings/organization', {
      method: 'PUT',
      body: { settings: { defaultCurrency: 'EUR' } },
    });
    expect(orgRes.status, JSON.stringify(orgRes.body)).toBe(200);

    memberA = await createMemberWithPermissions(admin.organizationId, 'time-member-a', [
      'project.read',
      'time.entry.read',
      'time.entry.create',
      'time.entry.update',
      'time.entry.delete',
    ]);
    memberB = await createMemberWithPermissions(admin.organizationId, 'time-member-b', [
      'time.entry.read',
      'time.entry.create',
      'time.entry.update',
      'time.entry.delete',
    ]);
    projectOnly = await createMemberWithPermissions(admin.organizationId, 'time-proj-only', [
      'project.read',
      'project.create',
      'project.update',
    ]);

    foreignAdmin = await createOrganizationWithAdmin('phase5b-time-foreign');
    createdOrganizations.push(foreignAdmin.organizationId);

    projectActive = await createProject(admin, 'Phase 5B Active Project');
    projectOther = await createProject(admin, 'Phase 5B Secondary Project');
    projectArchived = await createProject(admin, 'Phase 5B Archived Project', 'archived');
    projectDeleted = await createProject(admin, 'Phase 5B Deleted Project');
    foreignProject = await createProject(foreignAdmin, 'Foreign Confidential Project');

    taskOnActive = await createTask(admin, projectActive, 'Design API Schema');
    taskOnOther = await createTask(admin, projectOther, 'Other Project Task');
    taskOnArchived = await createTask(admin, projectArchived, 'Archived Project Task');

    const delRes = await api(admin, `/api/v1/crm/projects/${projectDeleted}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupOrganizations(createdOrganizations);
  });

  it('1 & 2. creates direct project billable entries (explicit & default currency) and non-billable entries', async () => {
    const explicitRes = await api(memberA, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: projectActive,
        date: '2026-06-01T00:00:00.000Z',
        hours: '2.5',
        description: 'Direct project architecture',
        billable: true,
        hourlyRate: '150',
        currency: 'usd',
      },
    });
    expect(explicitRes.status, JSON.stringify(explicitRes.body)).toBe(201);
    const explicit = explicitRes.body as TimeEntryBody;
    expect(explicit.projectId).toBe(projectActive);
    expect(explicit.taskId).toBeNull();
    expect(explicit.userId).toBe(memberA.userId);
    expect(explicit.billable).toBe(true);
    expect(explicit.hourlyRate).toBe('150.00');
    expect(explicit.currency).toBe('USD');
    expect(explicit.billableAmount).toBe('375.00');
    expect(explicit.project?.id).toBe(projectActive);

    // Omitting currency uses org default (EUR)
    const defaultCurrRes = await api(memberA, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: projectActive,
        date: '2026-06-02T00:00:00.000Z',
        hours: '1.5',
        description: 'Workshop',
        billable: true,
        hourlyRate: '120.50',
      },
    });
    expect(defaultCurrRes.status, JSON.stringify(defaultCurrRes.body)).toBe(201);
    const defaultCurr = defaultCurrRes.body as TimeEntryBody;
    expect(defaultCurr.currency).toBe('EUR');
    expect(defaultCurr.billableAmount).toBe('180.75');

    // Non-billable entry ignores/clears billing fields
    const nonBillRes = await api(memberA, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: projectActive,
        date: '2026-06-03T00:00:00.000Z',
        hours: '1.25',
        description: 'Internal sync',
        billable: false,
        hourlyRate: '200.00',
        currency: 'USD',
      },
    });
    expect(nonBillRes.status).toBe(201);
    const nonBill = nonBillRes.body as TimeEntryBody;
    expect(nonBill.billable).toBe(false);
    expect(nonBill.hourlyRate).toBeNull();
    expect(nonBill.currency).toBeNull();
    expect(nonBill.billableAmount).toBeNull();
  });

  it('3. derives projectId from taskId, rejects mismatches, and retains projectId if task is deleted', async () => {
    const mismatch = await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: projectActive,
        taskId: taskOnOther,
        date: '2026-06-04T00:00:00.000Z',
        hours: '1',
        billable: true,
      },
    });
    expect(mismatch.status).toBe(400);

    const tempTaskId = await createTask(admin, projectOther, 'Ephemeral Task');
    const createdRes = await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        taskId: tempTaskId,
        date: '2026-06-04T00:00:00.000Z',
        hours: '2.0',
        description: 'Task-derived project link',
        billable: true,
        hourlyRate: '100.00',
        currency: 'USD',
      },
    });
    expect(createdRes.status).toBe(201);
    const created = createdRes.body as TimeEntryBody;
    expect(created.projectId).toBe(projectOther);
    expect(created.taskId).toBe(tempTaskId);

    // Delete the task: taskId sets null, projectId stays intact
    const delTaskRes = await api(admin, `/api/v1/projects/tasks/${tempTaskId}`, {
      method: 'DELETE',
    });
    expect(delTaskRes.status).toBe(200);

    const afterDeleteRes = await api(admin, `/api/v1/projects/time-entries/${created.id}`);
    expect(afterDeleteRes.status).toBe(200);
    const afterDelete = afterDeleteRes.body as TimeEntryBody;
    expect(afterDelete.taskId).toBeNull();
    expect(afterDelete.projectId).toBe(projectOther);
    expect(afterDelete.billableAmount).toBe('200.00');
  });

  it('4. rejects callers lacking time.entry permissions with 403', async () => {
    expect((await api(null, '/api/v1/projects/time-entries')).status).toBe(401);
    expect((await api(projectOnly, '/api/v1/projects/time-entries')).status).toBe(403);
    expect((await api(projectOnly, '/api/v1/projects/time-entries/summary')).status).toBe(403);
    expect(
      (
        await api(projectOnly, '/api/v1/projects/time-entries', {
          method: 'POST',
          body: {
            projectId: projectActive,
            date: '2026-06-05T00:00:00.000Z',
            hours: '1',
            billable: false,
          },
        })
      ).status
    ).toBe(403);
  });

  it('5. enforces ownership for non-admins while allowing Administrators', async () => {
    // Non-admin cannot create an entry attributed to another user
    const spoofCreate = await api(memberA, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        userId: memberB.userId,
        projectId: projectActive,
        date: '2026-06-05T00:00:00.000Z',
        hours: '1',
        billable: false,
      },
    });
    expect(spoofCreate.status).toBe(403);

    // Member B creates their own entry
    const bCreate = await api(memberB, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: projectOther,
        date: '2026-06-05T00:00:00.000Z',
        hours: '2.0',
        description: 'Member B entry',
        billable: true,
        hourlyRate: '90.00',
        currency: 'USD',
      },
    });
    expect(bCreate.status).toBe(201);
    const bEntry = bCreate.body as TimeEntryBody;

    // Member A cannot edit or delete Member B's entry
    expect(
      (
        await api(memberA, `/api/v1/projects/time-entries/${bEntry.id}`, {
          method: 'PUT',
          body: { description: 'Unauthorized tamper' },
        })
      ).status
    ).toBe(403);
    expect(
      (await api(memberA, `/api/v1/projects/time-entries/${bEntry.id}`, { method: 'DELETE' }))
        .status
    ).toBe(403);

    // Admin can create for Member B, update it, and delete it
    const adminOnBehalf = await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        userId: memberB.userId,
        projectId: projectOther,
        date: '2026-06-05T00:00:00.000Z',
        hours: '1.0',
        billable: false,
      },
    });
    expect(adminOnBehalf.status).toBe(201);
    const onBehalfId = (adminOnBehalf.body as TimeEntryBody).id;

    const adminEdit = await api(admin, `/api/v1/projects/time-entries/${bEntry.id}`, {
      method: 'PUT',
      body: { description: 'Approved adjustment' },
    });
    expect(adminEdit.status).toBe(200);
    expect((adminEdit.body as TimeEntryBody).hourlyRate).toBe('90.00');

    expect(
      (await api(admin, `/api/v1/projects/time-entries/${onBehalfId}`, { method: 'DELETE' })).status
    ).toBe(200);
  });

  it('6. enforces cross-organization isolation at HTTP and PostgreSQL composite FK layers', async () => {
    // Rejects client-supplied organizationId
    const evilOrg = await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        organizationId: foreignAdmin.organizationId,
        projectId: projectActive,
        date: '2026-06-05T00:00:00.000Z',
        hours: '1',
        billable: false,
      },
    });
    expect(evilOrg.status).toBe(400);

    // Foreign project / entry lookups return non-disclosing 404
    const crossPost = await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: foreignProject,
        date: '2026-06-05T00:00:00.000Z',
        hours: '1',
        billable: false,
      },
    });
    expect(crossPost.status).toBe(404);
    expect(JSON.stringify(crossPost.body)).not.toContain('Foreign Confidential');

    const ownRes = await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: projectOther,
        date: '2026-06-05T00:00:00.000Z',
        hours: '1',
        billable: false,
      },
    });
    const ownId = (ownRes.body as TimeEntryBody).id;
    expect((await api(foreignAdmin, `/api/v1/projects/time-entries/${ownId}`)).status).toBe(404);
    expect(
      (await api(foreignAdmin, `/api/v1/projects/time-entries?projectId=${projectActive}`)).status
    ).toBe(404);

    // Direct PostgreSQL composite FK enforcement
    await expect(
      prisma.timeEntry.create({
        data: {
          organizationId: admin.organizationId,
          userId: admin.userId,
          projectId: foreignProject,
          date: new Date('2026-06-05T00:00:00.000Z'),
          hours: 1,
          billable: false,
        },
      })
    ).rejects.toMatchObject({ code: 'P2003' });

    await expect(
      prisma.$executeRawUnsafe(
        'UPDATE "TimeEntry" SET "projectId" = $1 WHERE id = $2',
        foreignProject,
        ownId
      )
    ).rejects.toThrow(new RegExp(`${FK_NAME}|23503`));
  });

  it('7. blocks new links to archived (400) or deleted (404) projects while preserving historical reads', async () => {
    expect(
      (
        await api(admin, '/api/v1/projects/time-entries', {
          method: 'POST',
          body: {
            projectId: projectArchived,
            date: '2026-06-06T00:00:00.000Z',
            hours: '1',
            billable: true,
          },
        })
      ).status
    ).toBe(400);

    expect(
      (
        await api(admin, '/api/v1/projects/time-entries', {
          method: 'POST',
          body: {
            taskId: taskOnArchived,
            date: '2026-06-06T00:00:00.000Z',
            hours: '1',
            billable: true,
          },
        })
      ).status
    ).toBe(400);

    expect(
      (
        await api(admin, '/api/v1/projects/time-entries', {
          method: 'POST',
          body: {
            projectId: projectDeleted,
            date: '2026-06-06T00:00:00.000Z',
            hours: '1',
            billable: true,
          },
        })
      ).status
    ).toBe(404);

    // Active project receives an entry, then is archived; entry stays readable & editable for typos
    const tempProject = await createProject(admin, 'Soon Archived Time Project');
    const histRes = await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: tempProject,
        date: '2026-06-06T00:00:00.000Z',
        hours: '2.0',
        description: 'Historical work',
        billable: true,
        hourlyRate: '110.00',
        currency: 'USD',
      },
    });
    expect(histRes.status).toBe(201);
    const histId = (histRes.body as TimeEntryBody).id;

    expect(
      (
        await api(admin, `/api/v1/crm/projects/${tempProject}`, {
          method: 'PUT',
          body: { status: 'archived' },
        })
      ).status
    ).toBe(200);

    const readHist = await api(admin, `/api/v1/projects/time-entries/${histId}`);
    expect(readHist.status).toBe(200);
    expect((readHist.body as TimeEntryBody).project?.status).toBe('archived');

    const fixTypo = await api(admin, `/api/v1/projects/time-entries/${histId}`, {
      method: 'PUT',
      body: { description: 'Historical work (clarified)' },
    });
    expect(fixTypo.status).toBe(200);
    expect((fixTypo.body as TimeEntryBody).billableAmount).toBe('220.00');
  });

  it('8. preserves snapshotted rate/currency when org defaults change and enforces billing edge rules', async () => {
    const eurCreate = await api(memberA, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        taskId: taskOnActive,
        date: '2026-06-07T00:00:00.000Z',
        hours: '3.0',
        description: 'Snapshot check',
        billable: true,
        hourlyRate: '80.00',
      },
    });
    expect(eurCreate.status).toBe(201);
    const entry = eurCreate.body as TimeEntryBody;
    expect(entry.currency).toBe('EUR');

    // Change org defaultCurrency to GBP after entry was created
    expect(
      (
        await api(admin, '/api/v1/settings/organization', {
          method: 'PUT',
          body: { settings: { defaultCurrency: 'GBP' } },
        })
      ).status
    ).toBe(200);

    // Partial update of hours must retain EUR and 80.00 rate (no currency mutation, no default leak)
    const hoursEdit = await api(memberA, `/api/v1/projects/time-entries/${entry.id}`, {
      method: 'PUT',
      body: { hours: '4.0' },
    });
    expect(hoursEdit.status).toBe(200);
    const edited = hoursEdit.body as TimeEntryBody;
    expect(edited.billable).toBe(true);
    expect(edited.hourlyRate).toBe('80.00');
    expect(edited.currency).toBe('EUR');
    expect(edited.billableAmount).toBe('320.00');

    // Currency without hourlyRate rejected
    expect(
      (
        await api(memberA, '/api/v1/projects/time-entries', {
          method: 'POST',
          body: {
            projectId: projectActive,
            date: '2026-06-07T00:00:00.000Z',
            hours: '1.0',
            billable: true,
            currency: 'USD',
          },
        })
      ).status
    ).toBe(400);

    // Toggling billable -> false clears rate & currency
    const nonBillToggle = await api(memberA, `/api/v1/projects/time-entries/${entry.id}`, {
      method: 'PUT',
      body: { billable: false },
    });
    expect(nonBillToggle.status).toBe(200);
    expect((nonBillToggle.body as TimeEntryBody).hourlyRate).toBeNull();
    expect((nonBillToggle.body as TimeEntryBody).currency).toBeNull();

    // Setting rate on non-billable entry without billable: true rejected
    expect(
      (
        await api(memberA, `/api/v1/projects/time-entries/${entry.id}`, {
          method: 'PUT',
          body: { hourlyRate: '100.00' },
        })
      ).status
    ).toBe(400);
  });

  it('9. aggregates project time summary accurately across currencies without affecting invoices', async () => {
    const sumProject = await createProject(admin, 'Multi-Currency Summary Project');
    const sumTask = await createTask(admin, sumProject, 'Summary Task');

    const beforeInvRes = await api(admin, '/api/v1/crm/invoices', {
      method: 'POST',
      body: {
        projectId: sumProject,
        title: 'Unchanged Project Invoice',
        currency: 'USD',
        lineItems: [
          { description: 'Milestone', quantity: '1', unitPrice: '1000.00', taxRate: '0' },
        ],
      },
    });
    expect(beforeInvRes.status).toBe(201);
    const invBefore = beforeInvRes.body as { id: string; number: string; total: string };

    // Direct USD billable + task-linked EUR billable + unrated billable + non-billable
    await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: sumProject,
        date: '2026-06-08T00:00:00.000Z',
        hours: '2.5',
        billable: true,
        hourlyRate: '100.00',
        currency: 'USD',
      },
    });
    await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        taskId: sumTask,
        date: '2026-06-08T00:00:00.000Z',
        hours: '1.5',
        billable: true,
        hourlyRate: '80.00',
        currency: 'EUR',
      },
    });
    await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: sumProject,
        date: '2026-06-08T00:00:00.000Z',
        hours: '3.0',
        billable: true,
      },
    });
    await api(admin, '/api/v1/projects/time-entries', {
      method: 'POST',
      body: {
        projectId: sumProject,
        date: '2026-06-08T00:00:00.000Z',
        hours: '1.25',
        billable: false,
      },
    });

    const listRes = await api(admin, `/api/v1/projects/time-entries?projectId=${sumProject}`);
    expect(listRes.status).toBe(200);
    expect((listRes.body as TimeEntryBody[]).length).toBe(4);

    const summaryRes = await api(
      admin,
      `/api/v1/projects/time-entries/summary?projectId=${sumProject}`
    );
    expect(summaryRes.status).toBe(200);
    const summary = summaryRes.body as TimeEntrySummaryBody;
    expect(summary.entryCount).toBe(4);
    expect(summary.totalHours).toBe(8.25);
    expect(summary.billableHours).toBe(7);
    expect(summary.nonBillableHours).toBe(1.25);
    expect(summary.unratedBillableEntryCount).toBe(1);
    expect(summary.unratedBillableHours).toBe(3);
    expect(summary.billableAmountsByCurrency).toEqual([
      {
        currency: 'EUR',
        amount: '120.00',
        amountMinor: 12000,
        billableHours: 1.5,
        entryCount: 1,
      },
      {
        currency: 'USD',
        amount: '250.00',
        amountMinor: 25000,
        billableHours: 2.5,
        entryCount: 1,
      },
    ]);

    // Invoice totals & numbering untouched
    const invAfterRes = await api(admin, `/api/v1/crm/invoices/${invBefore.id}`);
    expect(invAfterRes.status).toBe(200);
    expect(invAfterRes.body).toMatchObject({
      number: invBefore.number,
      total: invBefore.total,
    });
  });

  it('10. migration 0022 supports legacy backfill, NO ACTION on project delete, and org cascade', async () => {
    const disposable = await createOrganizationWithAdmin('phase5b-time-disposable');
    const proj = (await prisma.project.create({
      data: { organizationId: disposable.organizationId, name: 'Disposable Time Project' },
    })) as { id: string };
    const task = (await prisma.task.create({
      data: {
        organizationId: disposable.organizationId,
        projectId: proj.id,
        title: 'Legacy Task',
      },
    })) as { id: string };

    // Simulate pre-0022 row (taskId set, projectId null) and verify backfill SQL semantics
    const legacyEntry = (await prisma.timeEntry.create({
      data: {
        organizationId: disposable.organizationId,
        userId: disposable.userId,
        taskId: task.id,
        projectId: null,
        date: new Date('2026-05-01T00:00:00.000Z'),
        hours: 2,
        billable: false,
      },
    })) as { id: string; projectId: string | null };
    expect(legacyEntry.projectId).toBeNull();

    await prisma.$executeRawUnsafe(`
      UPDATE "TimeEntry" AS te
      SET "projectId" = t."projectId"
      FROM "Task" AS t
      WHERE te."taskId" = t."id"
        AND te."organizationId" = t."organizationId"
        AND te."projectId" IS NULL
        AND te."id" = '${legacyEntry.id}'
    `);

    const backfilled = (await prisma.timeEntry.findUniqueOrThrow({
      where: { id: legacyEntry.id },
      select: { projectId: true },
    })) as { projectId: string | null };
    expect(backfilled.projectId).toBe(proj.id);

    // Raw hard-delete of project with TimeEntry fails on composite FK (23503)
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM "Project" WHERE id = $1', proj.id)
    ).rejects.toThrow(new RegExp(`${FK_NAME}|23503`));

    // Whole organization delete succeeds cleanly via statement-end NO ACTION evaluation
    await prisma.organization.delete({ where: { id: disposable.organizationId } });
    expect(await prisma.timeEntry.count({ where: { id: legacyEntry.id } })).toBe(0);
    expect(await prisma.project.count({ where: { id: proj.id } })).toBe(0);
    await prisma.user.deleteMany({ where: { id: disposable.userId } }).catch(() => {});
  });
});
