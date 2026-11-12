/**
 * Unit tests for the client-facing workspace reads.
 *
 * Focus: only granted ids are ever read, every query is organization-scoped
 * (including the file-asset join), a client never receives internal project data,
 * and downloading requires both the capability and a live grant.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    clientResourceGrant: { findMany: vi.fn(), count: vi.fn() },
    project: { findMany: vi.fn(), findFirst: vi.fn() },
    projectFile: { findMany: vi.fn(), findFirst: vi.fn() },
    document: { findMany: vi.fn(), findFirst: vi.fn() },
    invoice: { findMany: vi.fn() },
    contract: { findMany: vi.fn() },
    proposal: { findMany: vi.fn(), findFirst: vi.fn() },
    quotation: { findMany: vi.fn(), findFirst: vi.fn() },
    estimate: { findMany: vi.fn(), findFirst: vi.fn() },
    clientApproval: { findMany: vi.fn() },
    clientComment: { findMany: vi.fn() },
    notification: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    notificationPreference: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/portal/access-control', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/access-control')>();
  return {
    ...actual,
    requirePortalAccess: vi.fn(),
    requirePortalCapability: vi.fn(),
    requireGrantedResource: vi.fn(),
    listGrantedResourceIds: vi.fn(),
  };
});

vi.mock('@/lib/portal/storage', () => ({
  readStoredFile: vi.fn(),
}));

vi.mock('@/lib/services/automation/notification-service', () => ({
  isNotificationAllowed: vi.fn().mockResolvedValue(true),
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { prisma } from '@/lib/db';
import {
  listGrantedResourceIds,
  requireGrantedResource,
  requirePortalAccess,
  requirePortalCapability,
} from '@/lib/portal/access-control';
import { readStoredFile } from '@/lib/portal/storage';
import {
  downloadPortalFile,
  getPortalProject,
  listPortalInvoices,
  listPortalNotifications,
  listPortalProjects,
  markPortalNotificationRead,
} from '@/lib/services/portal/portal-workspace-service';

const mockRequirePortalAccess = requirePortalAccess as unknown as ReturnType<typeof vi.fn>;
const mockRequirePortalCapability = requirePortalCapability as unknown as ReturnType<typeof vi.fn>;
const mockRequireGrantedResource = requireGrantedResource as unknown as ReturnType<typeof vi.fn>;
const mockListGrantedIds = listGrantedResourceIds as unknown as ReturnType<typeof vi.fn>;
const mockReadStoredFile = readStoredFile as unknown as ReturnType<typeof vi.fn>;

const mockProjectFindMany = prisma.project.findMany as unknown as ReturnType<typeof vi.fn>;
const mockProjectFindFirst = prisma.project.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockProjectFileFindFirst = prisma.projectFile.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockDocumentFindFirst = prisma.document.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceFindMany = prisma.invoice.findMany as unknown as ReturnType<typeof vi.fn>;
const mockNotificationFindMany = prisma.notification.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockNotificationFindFirst = prisma.notification.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockNotificationUpdate = prisma.notification.update as unknown as ReturnType<typeof vi.fn>;

const organizationId = 'org_1';
const accessId = 'access_1';
const clientUserId = 'client_user_1';

const context = {
  userId: clientUserId,
  email: 'clara@client.test',
  name: 'Clara Client',
  accessId,
  organizationId,
  organizationName: 'Acme Agency',
  contactId: 'contact_1',
  contactName: 'Clara Client',
  role: 'client_approver',
  status: 'active',
  canViewInvoices: true,
  canDownloadFiles: true,
  canComment: true,
  canApprove: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePortalAccess.mockResolvedValue(context);
  mockRequirePortalCapability.mockResolvedValue(context);
});

describe('listPortalProjects', () => {
  it('returns nothing when the client holds no project grant', async () => {
    mockListGrantedIds.mockResolvedValue([]);

    await expect(listPortalProjects()).resolves.toEqual([]);
    expect(mockProjectFindMany).not.toHaveBeenCalled();
  });

  it('reads only granted ids, scoped to the client organization', async () => {
    mockListGrantedIds.mockResolvedValue(['project_1']);
    mockProjectFindMany.mockResolvedValue([
      {
        id: 'project_1',
        name: 'Website redesign',
        description: null,
        status: 'active',
        startDate: null,
        endDate: null,
        _count: { milestones: 2, tasks: 4 },
        milestones: [{ status: 'completed' }, { status: 'pending' }],
        tasks: [{ status: 'done' }, { status: 'todo' }, { status: 'todo' }, { status: 'todo' }],
      },
    ]);

    const projects = await listPortalProjects();

    expect(mockProjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['project_1'] }, organizationId, deletedAt: null },
      })
    );
    expect(projects[0]).toMatchObject({ completedMilestones: 1, completedTasks: 1, taskCount: 4 });

    // No internal project detail may leak into the projection.
    const serialized = JSON.stringify(projects);
    expect(serialized).not.toContain('budget');
    expect(serialized).not.toContain('assignee');
    expect(serialized).not.toContain('clientId');
  });
});

describe('getPortalProject', () => {
  it('never selects or exposes project invoices, time entries, budgets, or clientId', async () => {
    mockRequireGrantedResource.mockResolvedValue({ grant: { id: 'grant_p1' }, resource: {} });
    mockProjectFindFirst.mockResolvedValue({
      id: 'project_1',
      name: 'Client Portal Project',
      description: 'Phase 5A client-mismatch verification',
      status: 'active',
      startDate: null,
      endDate: null,
      milestones: [],
      tasks: [{ status: 'done' }],
      files: [],
      invoices: [{ id: 'inv_third_party', number: 'INV-999', clientId: 'other_contact' }],
      timeEntries: [{ id: 'te_1', hours: '5', hourlyRate: '200', currency: 'USD' }],
      clientId: 'contact_1',
      budget: '50000',
    });
    mockListGrantedIds.mockResolvedValue([]);

    const detail = await getPortalProject('project_1');

    expect(mockInvoiceFindMany).not.toHaveBeenCalled();
    const { select } = mockProjectFindFirst.mock.calls[0][0] as {
      select: Record<string, unknown>;
    };
    expect(select).not.toHaveProperty('invoices');
    expect(select).not.toHaveProperty('timeEntries');
    expect(select).not.toHaveProperty('clientId');
    expect(select).not.toHaveProperty('budget');

    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('inv_third_party');
    expect(serialized).not.toContain('INV-999');
    expect(serialized).not.toContain('other_contact');
    expect(serialized).not.toContain('te_1');
    expect(serialized).not.toContain('50000');
  });
});

describe('listPortalInvoices', () => {
  it('requires the viewInvoices capability before reading anything', async () => {
    mockRequirePortalCapability.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );

    await expect(listPortalInvoices()).rejects.toMatchObject({ statusCode: 403 });
    expect(mockInvoiceFindMany).not.toHaveBeenCalled();
    expect(mockRequirePortalCapability).toHaveBeenCalledWith('viewInvoices');
  });

  it('computes the outstanding balance from recorded payments', async () => {
    mockListGrantedIds.mockResolvedValue(['invoice_1']);
    mockInvoiceFindMany.mockResolvedValue([
      {
        id: 'invoice_1',
        number: 'INV-001',
        title: 'Design retainer',
        status: 'sent',
        currency: 'USD',
        subtotal: { toString: () => '1000' },
        tax: { toString: () => '0' },
        total: { toString: () => '1000' },
        dueDate: null,
        payments: [
          { amount: { toString: () => '250' }, paidAt: new Date(), method: 'bank_transfer' },
        ],
      },
    ]);

    const invoices = await listPortalInvoices();

    expect(invoices[0]).toMatchObject({ number: 'INV-001', outstanding: '750.00' });
  });

  it('never exposes the linked project of an invoice to a client', async () => {
    // Phase 5A: invoices may carry an internal project link. The portal view is
    // built from an explicit column list, so the link (and anything about the
    // project) stays inside the agency even if the row carries it.
    mockListGrantedIds.mockResolvedValue(['invoice_1']);
    mockInvoiceFindMany.mockResolvedValue([
      {
        id: 'invoice_1',
        number: 'INV-001',
        title: 'Design retainer',
        status: 'sent',
        currency: 'USD',
        subtotal: { toString: () => '1000' },
        tax: { toString: () => '0' },
        total: { toString: () => '1000' },
        dueDate: null,
        payments: [],
        projectId: 'project_1',
        project: { id: 'project_1', name: 'Internal codename', status: 'active' },
      },
    ]);

    const invoices = await listPortalInvoices();

    expect(invoices[0]).not.toHaveProperty('projectId');
    expect(invoices[0]).not.toHaveProperty('project');
    expect(JSON.stringify(invoices)).not.toContain('Internal codename');
    expect(JSON.stringify(invoices)).not.toContain('project_1');

    const { select } = mockInvoiceFindMany.mock.calls[0][0] as { select: Record<string, unknown> };
    expect(select).not.toHaveProperty('projectId');
    expect(select).not.toHaveProperty('project');
  });

  it('scopes the invoice query to the organization and excludes deleted invoices', async () => {
    mockListGrantedIds.mockResolvedValue(['invoice_1']);
    mockInvoiceFindMany.mockResolvedValue([]);

    await listPortalInvoices();

    expect(mockInvoiceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['invoice_1'] }, organizationId, deletedAt: null },
      })
    );
  });
});

describe('downloadPortalFile', () => {
  it('requires the downloadFiles capability', async () => {
    mockRequirePortalCapability.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );

    await expect(downloadPortalFile('file', 'file_1')).rejects.toMatchObject({ statusCode: 403 });
    expect(mockRequirePortalCapability).toHaveBeenCalledWith('downloadFiles');
    expect(mockReadStoredFile).not.toHaveBeenCalled();
  });

  it('requires a grant for the exact file', async () => {
    mockRequireGrantedResource.mockRejectedValue(
      Object.assign(new Error('Not found'), { statusCode: 404 })
    );

    await expect(downloadPortalFile('file', 'file_ungranted')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockProjectFileFindFirst).not.toHaveBeenCalled();
    expect(mockReadStoredFile).not.toHaveBeenCalled();
  });

  it('joins the file asset on the organization so a foreign blob cannot be served', async () => {
    mockRequireGrantedResource.mockResolvedValue({ grant: { id: 'grant_1' }, resource: {} });
    mockProjectFileFindFirst.mockResolvedValue({
      fileAsset: {
        storagePath: 'org_1/file.pdf',
        originalName: 'brief.pdf',
        mimeType: 'application/pdf',
      },
    });
    mockReadStoredFile.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      originalName: 'brief.pdf',
      mimeType: 'application/pdf',
      size: 3,
    });

    const file = await downloadPortalFile('file', 'file_1');

    expect(mockProjectFileFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'file_1',
          organizationId,
          fileAsset: { organizationId },
        },
      })
    );
    expect(file.originalName).toBe('brief.pdf');
  });

  it('answers 404 when the file row has no asset in this organization', async () => {
    mockRequireGrantedResource.mockResolvedValue({ grant: { id: 'grant_1' }, resource: {} });
    mockProjectFileFindFirst.mockResolvedValue(null);

    await expect(downloadPortalFile('file', 'file_1')).rejects.toMatchObject({ statusCode: 404 });
    expect(mockReadStoredFile).not.toHaveBeenCalled();
  });

  it('serves a granted document attachment through the same guards', async () => {
    mockRequireGrantedResource.mockResolvedValue({ grant: { id: 'grant_1' }, resource: {} });
    mockDocumentFindFirst.mockResolvedValue({
      fileAsset: {
        storagePath: 'org_1/doc.pdf',
        originalName: 'contract.pdf',
        mimeType: 'application/pdf',
      },
    });
    mockReadStoredFile.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      originalName: 'contract.pdf',
      mimeType: 'application/pdf',
      size: 3,
    });

    const file = await downloadPortalFile('document', 'doc_1');

    expect(mockDocumentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc_1', organizationId, fileAsset: { organizationId } },
      })
    );
    expect(file.originalName).toBe('contract.pdf');
  });
});

describe('notifications', () => {
  it('reads only the signed-in client own notifications', async () => {
    mockNotificationFindMany.mockResolvedValue([]);

    await listPortalNotifications();

    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId, userId: clientUserId },
      })
    );
  });

  it('refuses to mark another user notification read', async () => {
    mockNotificationFindFirst.mockResolvedValue(null);

    await expect(markPortalNotificationRead('notification_other_user')).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockNotificationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notification_other_user', organizationId, userId: clientUserId },
      })
    );
    expect(mockNotificationUpdate).not.toHaveBeenCalled();
  });

  it('marks an own notification read', async () => {
    mockNotificationFindFirst.mockResolvedValue({ id: 'notification_1' });
    mockNotificationUpdate.mockResolvedValue({});

    await expect(markPortalNotificationRead('notification_1')).resolves.toEqual({
      id: 'notification_1',
      read: true,
    });
  });
});
