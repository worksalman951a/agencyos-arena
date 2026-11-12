/**
 * Unit tests for Projects schemas, permissions, and sub-module services.
 *
 * Covers:
 * - Migration 0013 permission code parity across bootstrap, backfill, and navigation
 * - Zod schema validation across Projects & all sub-modules
 * - Service-layer org scoping, permission enforcement, state transitions, author
 *   identity enforcement on comments, and file upload/download security guards.
 */

const mocks = vi.hoisted(() => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    projectTemplate: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    milestone: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    taskComment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    projectApproval: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    changeOrder: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    invoiceItem: { findFirst: vi.fn() },
    projectFile: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    fileAsset: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    document: { count: vi.fn() },
    documentVersion: { count: vi.fn() },
    timeEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    contact: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    userRole: { findFirst: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
  getSession: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma, default: mocks.prisma }));
vi.mock('@/lib/permissions', () => ({
  requirePermission: mocks.requirePermission,
  requireOrganization: mocks.requireOrganization,
}));
vi.mock('@/lib/auth-server', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));

vi.mock('@/lib/services/automation/run-workflow-service', () => ({
  emitWorkflowEvent: vi.fn(async () => ({})),
  emitWorkflowEvents: vi.fn(async () => []),
}));

import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { NAV_SECTIONS } from '@/lib/navigation';
import {
  projectCreateSchema,
  projectUpdateSchema,
  projectTaskSchema,
  projectTaskUpdateSchema,
} from '@/lib/schemas/crm/project.schema';
import {
  milestoneCreateSchema,
  milestoneUpdateSchema,
} from '@/lib/schemas/projects/milestone.schema';
import {
  changeOrderCreateSchema,
  changeOrderUpdateSchema,
} from '@/lib/schemas/projects/change-order.schema';
import {
  projectApprovalCreateSchema,
  projectApprovalUpdateSchema,
} from '@/lib/schemas/projects/project-approval.schema';
import { taskCommentCreateSchema } from '@/lib/schemas/projects/task-comment.schema';
import {
  timeEntryCreateSchema,
  timeEntryUpdateSchema,
} from '@/lib/schemas/projects/time-entry.schema';
import { projectTemplateCreateSchema } from '@/lib/schemas/projects/project-template.schema';

import {
  createTaskComment,
  updateTaskComment,
  deleteTaskComment,
} from '@/lib/services/projects/task-comment-service';
import {
  createProjectApproval,
  updateProjectApproval,
} from '@/lib/services/projects/project-approval-service';
import { createChangeOrder, updateChangeOrder } from '@/lib/services/projects/change-order-service';
import { createMilestone, updateMilestone } from '@/lib/services/projects/milestone-service';
import {
  uploadProjectFile,
  downloadProjectFile,
  deleteProjectFile,
} from '@/lib/services/projects/project-file-service';
import {
  createTimeEntry,
  deleteTimeEntry,
  getTimeEntrySummary,
  listTimeEntries,
  updateTimeEntry,
} from '@/lib/services/projects/time-entry-service';
import { createProjectTemplate } from '@/lib/services/projects/project-template-service';
import { updateProjectTask, listProjectMembers } from '@/lib/services/crm/project-service';

const CUID_1 = 'claaaaaaaaaaaaaaaaaaaaaaa';
const CUID_2 = 'clbbbbbbbbbbbbbbbbbbbbbbb';

function setupAuth(userId = 'user-1', orgId = 'org-1') {
  mocks.getSession.mockResolvedValue({
    session: { id: 'sess-1' },
    user: { id: userId, email: 'member@agency.test' },
  });
  mocks.requireOrganization.mockResolvedValue({ organizationId: orgId });
  mocks.requirePermission.mockResolvedValue(undefined);
  mocks.cookies.mockResolvedValue({ toString: () => 'better-auth.session_token=tok' });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAuth();
});

describe('Migration 0013 Projects permission parity', () => {
  const migration22 = [
    'project.template.create',
    'project.template.read',
    'project.template.update',
    'project.template.delete',
    'project.file.create',
    'project.file.read',
    'project.file.delete',
    'project.approval.create',
    'project.approval.read',
    'project.approval.update',
    'time.entry.create',
    'time.entry.read',
    'time.entry.update',
    'time.entry.delete',
    'change.order.create',
    'change.order.read',
    'change.order.update',
    'change.order.delete',
    'task.comment.create',
    'task.comment.read',
    'task.comment.update',
    'task.comment.delete',
  ];

  it('seeds all 22 migration-0013 codes in bootstrap-organization and backfill script', () => {
    const bootstrapSrc = readFileSync(
      path.join(process.cwd(), 'app/api/auth/bootstrap-organization/route.ts'),
      'utf8'
    );
    const backfillSrc = readFileSync(
      path.join(process.cwd(), 'scripts/backfill-document-permissions.ts'),
      'utf8'
    );

    for (const code of migration22) {
      expect(bootstrapSrc).toContain(`'${code}'`);
      expect(backfillSrc).toContain(`'${code}'`);
    }
  });

  it('uses project.template.read on the Templates sidebar navigation item', () => {
    const projectsSection = NAV_SECTIONS.find((s) => s.label === 'Projects');
    const templatesItem = projectsSection?.items.find((i) => i.href === '/projects/templates');
    expect(templatesItem?.permission).toBe('project.template.read');
  });
});

describe('Projects Zod schemas', () => {
  it('validates project dates and allows templateId on create & update', () => {
    expect(
      projectCreateSchema.safeParse({
        name: 'Site Launch',
        templateId: CUID_1,
        startDate: '2026-06-10',
        endDate: '2026-06-01',
      }).success
    ).toBe(false);

    expect(
      projectCreateSchema.safeParse({
        name: 'Site Launch',
        templateId: CUID_1,
        startDate: '2026-06-01',
        endDate: '2026-06-10',
        budget: '2500.00',
      }).success
    ).toBe(true);

    expect(projectUpdateSchema.safeParse({}).success).toBe(false);
    expect(projectUpdateSchema.safeParse({ templateId: null }).success).toBe(true);
    // Partial updates must never inject default status
    expect(projectUpdateSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('validates tasks, milestones, change orders, approvals, comments, time entries, templates', () => {
    expect(projectTaskSchema.safeParse({ title: 'Build API', milestoneId: CUID_1 }).success).toBe(
      true
    );
    expect(projectTaskUpdateSchema.safeParse({}).success).toBe(false);
    expect(projectTaskUpdateSchema.parse({ title: 'Updated task' })).toEqual({
      title: 'Updated task',
    });
    expect(milestoneCreateSchema.safeParse({ projectId: CUID_1, name: 'Phase 1' }).success).toBe(
      true
    );
    expect(milestoneUpdateSchema.safeParse({}).success).toBe(false);

    expect(
      changeOrderCreateSchema.safeParse({
        projectId: CUID_1,
        description: 'Extra page',
        amount: 'NaN',
      }).success
    ).toBe(false);
    expect(changeOrderUpdateSchema.safeParse({ status: 'approved' }).success).toBe(true);

    expect(
      projectApprovalCreateSchema.safeParse({
        projectId: CUID_1,
        status: 'rejected',
        feedback: 'Needs revision',
      }).success
    ).toBe(true);
    expect(projectApprovalUpdateSchema.safeParse({}).success).toBe(false);

    // taskCommentCreateSchema accepts deprecated userId for backwards compat; service ignores it
    expect(
      taskCommentCreateSchema.safeParse({
        taskId: CUID_1,
        userId: CUID_2,
        comment: 'Spoofed',
      }).success
    ).toBe(true);
    expect(
      taskCommentCreateSchema.safeParse({
        taskId: CUID_1,
        comment: 'Valid',
        extraField: 'nope',
      }).success
    ).toBe(false);

    expect(
      timeEntryCreateSchema.safeParse({
        date: '2026-06-01',
        hours: '0',
      }).success
    ).toBe(false);
    expect(
      timeEntryCreateSchema.safeParse({
        date: '2026-06-01',
        hours: '2.5',
        billable: true,
      }).success
    ).toBe(true);
    expect(timeEntryUpdateSchema.safeParse({}).success).toBe(false);

    expect(projectTemplateCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('Task comment author & moderation enforcement', () => {
  it('sets userId strictly from the authenticated session on create', async () => {
    mocks.prisma.task.findFirst.mockResolvedValue({
      id: CUID_1,
      organizationId: 'org-1',
      project: { deletedAt: null },
    });
    mocks.prisma.taskComment.create.mockResolvedValue({
      id: 'cmt-1',
      organizationId: 'org-1',
      taskId: CUID_1,
      userId: 'user-1',
      comment: 'Looks good',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 'user-1', name: 'Alice', email: 'member@agency.test' },
    });

    const created = await createTaskComment({
      taskId: CUID_1,
      userId: CUID_2,
      comment: '  Looks good  ',
    });

    expect(mocks.prisma.taskComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          taskId: CUID_1,
          userId: 'user-1',
          comment: 'Looks good',
        }),
      })
    );
    expect(created.userId).toBe('user-1');
  });

  it('forbids editing or deleting another user comment unless Administrator', async () => {
    mocks.prisma.taskComment.findFirst.mockResolvedValue({
      id: 'cmt-1',
      organizationId: 'org-1',
      taskId: CUID_1,
      userId: 'other-user',
      comment: 'Original',
    });
    mocks.prisma.userRole.findFirst.mockResolvedValue(null);

    await expect(updateTaskComment('cmt-1', { comment: 'Tampered' }, CUID_1)).rejects.toMatchObject(
      {
        statusCode: 403,
      }
    );
    await expect(deleteTaskComment('cmt-1', CUID_1)).rejects.toMatchObject({ statusCode: 403 });

    mocks.prisma.userRole.findFirst.mockResolvedValue({ id: 'ur-admin' });
    mocks.prisma.taskComment.delete.mockResolvedValue({ id: 'cmt-1' });
    const deleted = await deleteTaskComment('cmt-1', CUID_1);
    expect(deleted.id).toBe('cmt-1');
  });
});

describe('Approvals, Change Orders, Milestones, Tasks & Time Entries', () => {
  it('enforces approval transitions and sets/clears approvedAt', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ id: CUID_1, deletedAt: null });
    mocks.prisma.projectApproval.create.mockResolvedValue({
      id: 'app-1',
      organizationId: 'org-1',
      projectId: CUID_1,
      contactId: null,
      status: 'pending',
      feedback: null,
      approvedAt: null,
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await createProjectApproval({ projectId: CUID_1, status: 'pending' });
    expect(created.status).toBe('pending');
    expect(created.approvedAt).toBeNull();

    mocks.prisma.projectApproval.findFirst.mockResolvedValue({
      id: 'app-1',
      organizationId: 'org-1',
      projectId: CUID_1,
      contactId: null,
      status: 'approved',
      feedback: null,
      approvedAt: new Date(),
    });

    await expect(updateProjectApproval('app-1', { status: 'rejected' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('auto-populates approvedBy and hydrates approver when approving a ChangeOrder', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ id: CUID_1, deletedAt: null });
    mocks.prisma.changeOrder.create.mockResolvedValue({
      id: 'co-1',
      organizationId: 'org-1',
      projectId: CUID_1,
      description: 'Extra scope',
      amount: { toString: () => '1500.00' },
      status: 'pending',
      approvedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      project: { id: CUID_1, name: 'Site' },
    });

    const created = await createChangeOrder({
      projectId: CUID_1,
      description: 'Extra scope',
      amount: '1500.00',
      status: 'pending',
    });
    expect(created.status).toBe('pending');

    mocks.prisma.changeOrder.findFirst.mockResolvedValue({
      id: 'co-1',
      organizationId: 'org-1',
      projectId: CUID_1,
      description: 'Extra scope',
      amount: { toString: () => '1500.00' },
      status: 'pending',
      approvedBy: null,
    });
    mocks.prisma.changeOrder.update.mockResolvedValue({
      id: 'co-1',
      organizationId: 'org-1',
      projectId: CUID_1,
      description: 'Extra scope',
      amount: { toString: () => '1500.00' },
      status: 'approved',
      approvedBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      project: { id: CUID_1, name: 'Site' },
    });
    mocks.prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Alice',
      email: 'member@agency.test',
    });

    const approved = await updateChangeOrder('co-1', { status: 'approved' });
    expect(approved.approvedBy).toBe('user-1');
    expect(approved.approver?.email).toBe('member@agency.test');

    mocks.prisma.changeOrder.findFirst.mockResolvedValue({
      id: 'co-1',
      organizationId: 'org-1',
      status: 'approved',
      amount: { toString: () => '1500.00' },
    });
    await expect(updateChangeOrder('co-1', { status: 'pending' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('creates and updates milestones and enforces project org scope on tasks', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ id: CUID_1, deletedAt: null });
    mocks.prisma.milestone.create.mockResolvedValue({
      id: 'ms-1',
      organizationId: 'org-1',
      projectId: CUID_1,
      name: 'Beta',
      dueDate: null,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ms = await createMilestone({ projectId: CUID_1, name: 'Beta', status: 'pending' });
    expect(ms.name).toBe('Beta');

    mocks.prisma.milestone.findFirst.mockResolvedValue(null);
    await expect(updateMilestone('ms-foreign', { status: 'completed' })).rejects.toMatchObject({
      statusCode: 404,
    });

    mocks.prisma.task.findFirst.mockResolvedValue({
      id: 't-1',
      organizationId: 'org-1',
      projectId: CUID_1,
      title: 'Task 1',
      status: 'todo',
      priority: 'medium',
      assigneeId: null,
      milestoneId: null,
      dueDate: null,
      estimatedHours: null,
      project: { id: CUID_1, deletedAt: null },
    });
    mocks.prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      updateProjectTask('t-1', { assigneeId: 'foreign-user' }, CUID_1)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates time entry bounds, project filtering, members lookup, and template creation', async () => {
    mocks.prisma.task.findFirst.mockResolvedValue({
      id: CUID_1,
      organizationId: 'org-1',
      project: { deletedAt: null },
    });
    await expect(
      createTimeEntry({ taskId: CUID_1, date: '2026-06-01', hours: '0', billable: true })
    ).rejects.toMatchObject({ statusCode: 400 });

    mocks.prisma.project.findFirst.mockResolvedValue({ id: CUID_1, organizationId: 'org-1' });
    mocks.prisma.timeEntry.findMany.mockResolvedValue([]);
    await listTimeEntries(undefined, CUID_1, true);
    expect(mocks.prisma.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          OR: [{ projectId: CUID_1 }, { task: { projectId: CUID_1 } }],
          billable: true,
        },
      })
    );

    mocks.prisma.user.findMany.mockResolvedValue([
      { id: 'user-1', name: 'Alice', email: 'member@agency.test' },
    ]);
    const members = await listProjectMembers();
    expect(members).toHaveLength(1);

    mocks.prisma.projectTemplate.create.mockResolvedValue({
      id: 'tpl-1',
      organizationId: 'org-1',
      name: 'Brand Sprint',
      description: 'Standard scope',
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { projects: 0 },
    });
    const tpl = await createProjectTemplate({
      name: 'Brand Sprint',
      description: 'Standard scope',
    });
    expect(tpl.projectCount).toBe(0);
  });
});

describe('Project File upload, download, and cleanup security', () => {
  it('blocks dangerous extensions, stores files outside web root, downloads securely, and cleans up on delete', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agencyos-proj-files-'));
    const prevStorage = process.env.STORAGE_LOCAL_PATH;
    process.env.STORAGE_LOCAL_PATH = tmpRoot;

    try {
      mocks.prisma.project.findFirst.mockResolvedValue({ id: CUID_1, deletedAt: null });

      const dangerousFile = new File(['<svg onload=alert(1)/>'], 'payload.svg', {
        type: 'image/svg+xml',
      });
      await expect(
        uploadProjectFile({ projectId: CUID_1, file: dangerousFile })
      ).rejects.toMatchObject({ statusCode: 400 });

      const safeFile = new File(['hello project'], '../secret report.txt', { type: 'text/plain' });
      let storedRelativePath = '';
      mocks.prisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mocks.prisma) => Promise<unknown>) => {
          const tx = {
            ...mocks.prisma,
            fileAsset: {
              ...mocks.prisma.fileAsset,
              create: vi.fn(
                async ({
                  data,
                }: {
                  data: {
                    storagePath: string;
                    originalName: string;
                    mimeType: string;
                    size: number;
                  };
                }) => {
                  storedRelativePath = data.storagePath;
                  return {
                    id: 'asset-1',
                    originalName: data.originalName,
                    mimeType: data.mimeType,
                    size: data.size,
                  };
                }
              ),
            },
            projectFile: {
              ...mocks.prisma.projectFile,
              create: vi.fn(async () => ({
                id: 'pf-1',
                organizationId: 'org-1',
                projectId: CUID_1,
                taskId: null,
                fileAssetId: 'asset-1',
                userId: 'user-1',
                createdAt: new Date(),
                fileAsset: {
                  id: 'asset-1',
                  originalName: 'secret_report.txt',
                  mimeType: 'text/plain',
                  size: 13,
                },
                user: { id: 'user-1', name: 'Alice', email: 'member@agency.test' },
                task: null,
              })),
            },
          };
          return fn(tx as unknown as typeof mocks.prisma);
        }
      );

      const uploaded = await uploadProjectFile({ projectId: CUID_1, file: safeFile });
      expect(uploaded.id).toBe('pf-1');
      expect((uploaded.fileAsset as Record<string, unknown>)?.storagePath).toBeUndefined();
      expect(storedRelativePath.startsWith('org-1')).toBe(true);

      mocks.prisma.projectFile.findFirst.mockResolvedValue({
        id: 'pf-1',
        organizationId: 'org-1',
        projectId: CUID_1,
        fileAssetId: 'asset-1',
        fileAsset: {
          id: 'asset-1',
          organizationId: 'org-1',
          originalName: 'secret_report.txt',
          mimeType: 'text/plain',
          size: 13,
          storagePath: storedRelativePath,
        },
      });
      const downloaded = await downloadProjectFile('pf-1');
      expect(downloaded.buffer.toString('utf8')).toBe('hello project');

      mocks.prisma.projectFile.count.mockResolvedValue(0);
      mocks.prisma.document.count.mockResolvedValue(0);
      mocks.prisma.documentVersion.count.mockResolvedValue(0);
      mocks.prisma.projectFile.delete.mockResolvedValue({ id: 'pf-1' });
      mocks.prisma.fileAsset.delete.mockResolvedValue({ id: 'asset-1' });

      await deleteProjectFile('pf-1');
      await expect(fs.stat(path.join(tmpRoot, storedRelativePath))).rejects.toThrow();
    } finally {
      if (prevStorage === undefined) delete process.env.STORAGE_LOCAL_PATH;
      else process.env.STORAGE_LOCAL_PATH = prevStorage;
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('Phase 5B-1 TimeEntry project linking, billing rates, and ownership', () => {
  it('validates strict create/update schemas and prevents partial default leakage', () => {
    // Rejects client-supplied organizationId
    expect(
      timeEntryCreateSchema.safeParse({
        organizationId: 'org-evil',
        date: '2026-06-01',
        hours: '2',
      }).success
    ).toBe(false);

    // Rejects invalid currency & negative/3-decimal rate
    expect(
      timeEntryCreateSchema.safeParse({
        date: '2026-06-01',
        hours: '2',
        billable: true,
        hourlyRate: '100.123',
        currency: 'USD',
      }).success
    ).toBe(false);
    expect(
      timeEntryCreateSchema.safeParse({
        date: '2026-06-01',
        hours: '2',
        billable: true,
        hourlyRate: '100',
        currency: 'INVALID',
      }).success
    ).toBe(false);

    // Normalizes lowercase currency
    const valid = timeEntryCreateSchema.parse({
      projectId: CUID_1,
      date: '2026-06-01',
      hours: '2.5',
      billable: true,
      hourlyRate: '150',
      currency: 'eur',
    });
    expect(valid.currency).toBe('EUR');

    // Partial update must NOT inject billable: false default
    expect(timeEntryUpdateSchema.parse({ description: 'Clarified note' })).toEqual({
      description: 'Clarified note',
    });
  });

  it('creates direct project time entries and resolves org default currency when rate currency omitted', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({
      id: CUID_1,
      status: 'active',
    });
    mocks.prisma.organization.findUnique.mockResolvedValue({
      settings: { defaultCurrency: 'PKR' },
    });
    mocks.prisma.timeEntry.create.mockResolvedValue({
      id: 'te-1',
      organizationId: 'org-1',
      userId: 'user-1',
      projectId: CUID_1,
      taskId: null,
      date: new Date('2026-06-01T00:00:00.000Z'),
      hours: { toString: () => '2.5' },
      description: 'Architecture call',
      billable: true,
      hourlyRate: { toString: () => '150' },
      currency: 'PKR',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 'user-1', name: 'Alice', email: 'member@agency.test' },
      project: { id: CUID_1, name: 'Apollo', status: 'active', deletedAt: null },
      task: null,
    });

    const created = await createTimeEntry({
      projectId: CUID_1,
      taskId: null,
      date: '2026-06-01',
      hours: '2.5',
      description: 'Architecture call',
      billable: true,
      hourlyRate: '150',
    });

    expect(mocks.prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-1',
          projectId: CUID_1,
          taskId: null,
          billable: true,
          hourlyRate: '150.00',
          currency: 'PKR',
        }),
      })
    );
    expect(created.projectId).toBe(CUID_1);
    expect(created.hourlyRate).toBe('150.00');
    expect(created.currency).toBe('PKR');
    expect(created.billableAmount).toBe('375.00');
  });

  it('ignores billing fields on non-billable create and enforces currency/rate pairing', async () => {
    await expect(
      createTimeEntry({
        date: '2026-06-01',
        hours: '2',
        billable: true,
        currency: 'USD',
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    mocks.prisma.timeEntry.create.mockResolvedValue({
      id: 'te-nonbill',
      organizationId: 'org-1',
      userId: 'user-1',
      projectId: null,
      taskId: null,
      date: new Date('2026-06-01T00:00:00.000Z'),
      hours: { toString: () => '1.5' },
      description: null,
      billable: false,
      hourlyRate: null,
      currency: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 'user-1', name: 'Alice', email: 'member@agency.test' },
      project: null,
      task: null,
    });

    const created = await createTimeEntry({
      date: '2026-06-01',
      hours: '1.5',
      billable: false,
      hourlyRate: '120',
      currency: 'USD',
    });
    expect(mocks.prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billable: false,
          hourlyRate: null,
          currency: null,
        }),
      })
    );
    expect(created.billableAmount).toBeNull();
  });

  it('rejects archived projects, deleted projects, and mismatched task/project pairs', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ id: CUID_1, status: 'archived' });
    await expect(
      createTimeEntry({ projectId: CUID_1, date: '2026-06-01', hours: '1', billable: true })
    ).rejects.toMatchObject({ statusCode: 400 });

    mocks.prisma.project.findFirst.mockResolvedValue(null);
    await expect(
      createTimeEntry({ projectId: CUID_1, date: '2026-06-01', hours: '1', billable: true })
    ).rejects.toMatchObject({ statusCode: 404 });

    mocks.prisma.task.findFirst.mockResolvedValue({
      id: CUID_2,
      projectId: CUID_1,
      project: { id: CUID_1, status: 'active', deletedAt: null },
    });
    await expect(
      createTimeEntry({
        projectId: 'clccccccccccccccccccccccc',
        taskId: CUID_2,
        date: '2026-06-01',
        hours: '1',
        billable: true,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('enforces ownership on create/update/delete unless Administrator', async () => {
    mocks.prisma.userRole.findFirst.mockResolvedValue(null);

    await expect(
      createTimeEntry({
        userId: 'other-user',
        date: '2026-06-01',
        hours: '1',
        billable: false,
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    mocks.prisma.timeEntry.findFirst.mockResolvedValue({
      id: 'te-other',
      organizationId: 'org-1',
      userId: 'other-user',
      projectId: null,
      taskId: null,
      date: new Date('2026-06-01T00:00:00.000Z'),
      hours: { toString: () => '2' },
      description: 'Other user work',
      billable: true,
      hourlyRate: { toString: () => '100' },
      currency: 'USD',
      task: null,
    });

    await expect(updateTimeEntry('te-other', { description: 'Hijack' })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(deleteTimeEntry('te-other')).rejects.toMatchObject({ statusCode: 403 });

    // Administrator can modify and delete another user's entry
    mocks.prisma.userRole.findFirst.mockResolvedValue({ id: 'ur-admin' });
    mocks.prisma.timeEntry.update.mockResolvedValue({
      id: 'te-other',
      organizationId: 'org-1',
      userId: 'other-user',
      projectId: null,
      taskId: null,
      date: new Date('2026-06-01T00:00:00.000Z'),
      hours: { toString: () => '2' },
      description: 'Admin edit',
      billable: true,
      hourlyRate: { toString: () => '100' },
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 'other-user', name: 'Bob', email: 'bob@agency.test' },
      project: null,
      task: null,
    });

    const updated = await updateTimeEntry('te-other', { description: 'Admin edit' });
    // Snapshotted rate and currency remain intact on unrelated edit
    expect(updated.hourlyRate).toBe('100.00');
    expect(updated.currency).toBe('USD');
    expect(updated.billableAmount).toBe('200.00');

    mocks.prisma.timeEntry.delete.mockResolvedValue({ id: 'te-other' });
    const deleted = await deleteTimeEntry('te-other');
    expect(deleted.id).toBe('te-other');
  });

  it('preserves snapshotted currency when org settings change and clears rate when toggling non-billable', async () => {
    // Organization later switched defaultCurrency to GBP
    mocks.prisma.organization.findUnique.mockResolvedValue({
      settings: { defaultCurrency: 'GBP' },
    });
    mocks.prisma.timeEntry.findFirst.mockResolvedValue({
      id: 'te-eur',
      organizationId: 'org-1',
      userId: 'user-1',
      projectId: CUID_1,
      taskId: null,
      date: new Date('2026-06-01T00:00:00.000Z'),
      hours: { toString: () => '2' },
      description: 'Original',
      billable: true,
      hourlyRate: { toString: () => '120' },
      currency: 'EUR',
      task: null,
    });
    mocks.prisma.timeEntry.update.mockResolvedValue({
      id: 'te-eur',
      organizationId: 'org-1',
      userId: 'user-1',
      projectId: CUID_1,
      taskId: null,
      date: new Date('2026-06-01T00:00:00.000Z'),
      hours: { toString: () => '3' },
      description: 'Original',
      billable: true,
      hourlyRate: { toString: () => '120' },
      currency: 'EUR',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 'user-1', name: 'Alice', email: 'member@agency.test' },
      project: { id: CUID_1, name: 'Apollo', status: 'active', deletedAt: null },
      task: null,
    });

    const updated = await updateTimeEntry('te-eur', { hours: '3' });
    expect(mocks.prisma.timeEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billable: true,
          hourlyRate: '120.00',
          currency: 'EUR',
        }),
      })
    );
    expect(updated.currency).toBe('EUR');
    expect(updated.billableAmount).toBe('360.00');

    // Toggling billable: false clears hourlyRate and currency
    mocks.prisma.timeEntry.update.mockResolvedValue({
      id: 'te-eur',
      organizationId: 'org-1',
      userId: 'user-1',
      projectId: CUID_1,
      taskId: null,
      date: new Date('2026-06-01T00:00:00.000Z'),
      hours: { toString: () => '3' },
      description: 'Original',
      billable: false,
      hourlyRate: null,
      currency: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 'user-1', name: 'Alice', email: 'member@agency.test' },
      project: { id: CUID_1, name: 'Apollo', status: 'active', deletedAt: null },
      task: null,
    });

    await updateTimeEntry('te-eur', { billable: false });
    expect(mocks.prisma.timeEntry.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billable: false,
          hourlyRate: null,
          currency: null,
        }),
      })
    );
  });

  it('summarizes project time entries via getTimeEntrySummary with multi-currency separation', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ id: CUID_1, organizationId: 'org-1' });
    mocks.prisma.timeEntry.findMany.mockResolvedValue([
      {
        hours: { toString: () => '2' },
        billable: true,
        hourlyRate: { toString: () => '100' },
        currency: 'USD',
      },
      {
        hours: { toString: () => '1.5' },
        billable: true,
        hourlyRate: { toString: () => '80' },
        currency: 'EUR',
      },
      { hours: { toString: () => '1' }, billable: false, hourlyRate: null, currency: null },
    ]);

    const summary = await getTimeEntrySummary(undefined, CUID_1);
    expect(summary.entryCount).toBe(3);
    expect(summary.totalHours).toBe(4.5);
    expect(summary.billableHours).toBe(3.5);
    expect(summary.nonBillableHours).toBe(1);
    expect(summary.billableAmountsByCurrency).toHaveLength(2);
  });
});
