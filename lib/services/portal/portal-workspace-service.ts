'use server';

/**
 * Client-facing portal workspace.
 *
 * Every read starts from the signed-in client's portal context and from its
 * grants. There is no endpoint that accepts an id and looks the record up
 * directly: ids are only ever compared against `ClientResourceGrant` rows for the
 * caller, and the record is then re-fetched scoped to the client's organization.
 *
 * What a client can see, by resource type:
 * - project  : name, description, status, dates, milestone progress, and the
 *              files/contracts that were *separately* granted;
 * - proposal / quotation / estimate: totals, validity, status, line items;
 * - contract : title, status, signed date and signature reference (read-only;
 *              the audit trail is never re-written from the portal);
 * - document : title, type, version, and a download when the document itself is
 *              granted and the client may download files;
 * - invoice  : totals, status, payments (only with the `viewInvoices` flag);
 * - file     : download only, with the `downloadFiles` flag.
 *
 * Internal task detail, assignees, time entries, budgets and internal notes are
 * never selected.
 */

import { prisma } from '@/lib/db';
import {
  capabilityFlags,
  codedError,
  listGrantedResourceIds,
  requirePortalAccess,
  requirePortalCapability,
  requireGrantedResource,
  type PortalAccessContext,
} from '@/lib/portal/access-control';
import { isNotificationAllowed } from '@/lib/services/automation/notification-service';
import { readStoredFile, type StoredFile } from '@/lib/portal/storage';
import type { PortalResourceType } from '@/lib/portal/resource-registry';

export interface PortalDashboard {
  organizationName: string;
  clientName: string;
  capabilityFlags: ReturnType<typeof capabilityFlags>;
  counts: {
    projects: number;
    documents: number;
    invoices: number;
    pendingApprovals: number;
    unreadNotifications: number;
  };
  projects: Array<{ id: string; name: string; status: string; endDate: Date | null }>;
  pendingApprovals: Array<{ id: string; title: string; dueAt: Date | null; resourceType: string }>;
  recentFeedback: Array<{
    id: string;
    resourceType: string;
    body: string;
    authorType: string;
    createdAt: Date;
  }>;
}

/** Aggregate overview for the portal landing page. */
export async function getPortalDashboard(): Promise<PortalDashboard> {
  const context = await requirePortalAccess();

  const [projectIds, documentCount, invoiceCount, approvals, unread, feedback] = await Promise.all([
    listGrantedResourceIds(context, 'project'),
    countGranted(context, 'document'),
    context.canViewInvoices ? countGranted(context, 'invoice') : Promise.resolve(0),
    prisma.clientApproval.findMany({
      where: {
        organizationId: context.organizationId,
        clientAccessId: context.accessId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, dueAt: true, resourceType: true },
    }),
    prisma.notification.count({
      where: { organizationId: context.organizationId, userId: context.userId, read: false },
    }),
    prisma.clientComment.findMany({
      where: {
        organizationId: context.organizationId,
        clientAccessId: context.accessId,
        visibility: 'client',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, resourceType: true, body: true, authorType: true, createdAt: true },
    }),
  ]);

  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: {
          id: { in: projectIds },
          organizationId: context.organizationId,
          deletedAt: null,
        },
        select: { id: true, name: true, status: true, endDate: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      })
    : [];

  return {
    organizationName: context.organizationName,
    clientName: context.contactName,
    capabilityFlags: capabilityFlags(context),
    counts: {
      projects: projects.length,
      documents: documentCount,
      invoices: invoiceCount,
      pendingApprovals: approvals.length,
      unreadNotifications: unread,
    },
    projects,
    pendingApprovals: approvals,
    recentFeedback: feedback,
  };
}

async function countGranted(
  context: PortalAccessContext,
  type: PortalResourceType
): Promise<number> {
  return prisma.clientResourceGrant.count({
    where: {
      organizationId: context.organizationId,
      clientAccessId: context.accessId,
      resourceType: type,
      revokedAt: null,
    },
  });
}

interface PortalProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  _count: { milestones: number; tasks: number };
  milestones: Array<{ status: string }>;
  tasks: Array<{ status: string }>;
}

interface PortalProjectDetailRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  milestones: Array<{ id: string; name: string; status: string; dueDate: Date | null }>;
  tasks: Array<{ status: string }>;
  files: Array<{ id: string }>;
}

export interface PortalProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  milestoneCount: number;
  completedMilestones: number;
  taskCount: number;
  completedTasks: number;
}

/** Projects explicitly shared with the client. */
export async function listPortalProjects(): Promise<PortalProjectSummary[]> {
  const context = await requirePortalAccess();
  const ids = await listGrantedResourceIds(context, 'project');
  if (ids.length === 0) return [];

  const projects = (await prisma.project.findMany({
    where: { id: { in: ids }, organizationId: context.organizationId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      startDate: true,
      endDate: true,
      _count: { select: { milestones: true, tasks: true } },
      milestones: { select: { status: true } },
      tasks: { select: { status: true } },
    },
  })) as PortalProjectRow[];

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    startDate: project.startDate,
    endDate: project.endDate,
    milestoneCount: project._count.milestones,
    completedMilestones: project.milestones.filter((milestone) => milestone.status === 'completed')
      .length,
    taskCount: project._count.tasks,
    completedTasks: project.tasks.filter((task) => task.status === 'done').length,
  }));
}

export interface PortalProjectDetail extends PortalProjectSummary {
  milestones: Array<{ id: string; name: string; status: string; dueDate: Date | null }>;
  files: Array<{ id: string; title: string; mimeType: string; size: number }>;
  contracts: Array<{ id: string; title: string; status: string; signedAt: Date | null }>;
}

/**
 * One granted project with milestones and the deliverables that were shared
 * individually. Task titles, assignees, hours and budget stay internal.
 */
export async function getPortalProject(projectId: string): Promise<PortalProjectDetail> {
  const context = await requirePortalAccess();
  await requireGrantedResource(context, 'project', projectId);

  const project = (await prisma.project.findFirst({
    where: { id: projectId, organizationId: context.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      startDate: true,
      endDate: true,
      milestones: {
        select: { id: true, name: true, status: true, dueDate: true },
        orderBy: { dueDate: 'asc' },
      },
      tasks: { select: { status: true } },
      files: { select: { id: true } },
    },
  })) as PortalProjectDetailRow | null;
  if (!project) throw codedError('Not found', 404);

  // Only deliverables with their own grant are listed.
  const [grantedFileIds, grantedContractIds] = await Promise.all([
    listGrantedResourceIds(context, 'file'),
    listGrantedResourceIds(context, 'contract'),
  ]);
  const projectFileIds = new Set(project.files.map((file) => file.id));
  const visibleFileIds = grantedFileIds.filter((id) => projectFileIds.has(id));

  const [files, contracts] = await Promise.all([
    visibleFileIds.length
      ? ((await prisma.projectFile.findMany({
          where: {
            id: { in: visibleFileIds },
            organizationId: context.organizationId,
            fileAsset: { organizationId: context.organizationId },
          },
          select: {
            id: true,
            fileAsset: { select: { originalName: true, mimeType: true, size: true } },
          },
          orderBy: { createdAt: 'desc' },
        })) as Array<{
          id: string;
          fileAsset: { originalName: string; mimeType: string; size: number };
        }>)
      : Promise.resolve([]),
    grantedContractIds.length
      ? prisma.contract.findMany({
          where: {
            id: { in: grantedContractIds },
            organizationId: context.organizationId,
            projectId,
          },
          select: { id: true, title: true, status: true, signedAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
  ]);

  const completedMilestones = project.milestones.filter(
    (milestone) => milestone.status === 'completed'
  ).length;

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    startDate: project.startDate,
    endDate: project.endDate,
    milestoneCount: project.milestones.length,
    completedMilestones,
    taskCount: project.tasks.length,
    completedTasks: project.tasks.filter((task) => task.status === 'done').length,
    milestones: project.milestones,
    files: files.map((file) => ({
      id: file.id,
      title: file.fileAsset.originalName,
      mimeType: file.fileAsset.mimeType,
      size: file.fileAsset.size,
    })),
    contracts,
  };
}

export interface PortalDocumentView {
  grantId: string;
  type: string;
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  currency: string | null;
  total: string | null;
  validUntil: Date | null;
  signedAt: Date | null;
  signatureReference: string | null;
  items: Array<{ description: string; quantity: string; unitPrice: string; amount: string }>;
  downloadable: boolean;
}

/**
 * Commercial documents shared with the client: proposals, quotations,
 * estimates, contracts and plain documents.
 */
export async function listPortalDocuments(): Promise<PortalDocumentView[]> {
  const context = await requirePortalAccess();

  const grants = await prisma.clientResourceGrant.findMany({
    where: {
      organizationId: context.organizationId,
      clientAccessId: context.accessId,
      resourceType: { in: ['proposal', 'quotation', 'estimate', 'contract', 'document'] },
      revokedAt: null,
    },
    orderBy: { sharedAt: 'desc' },
    select: { id: true, resourceType: true, resourceId: true },
  });

  const canDownload = context.canDownloadFiles;
  const views: PortalDocumentView[] = [];

  for (const grant of grants) {
    const base = {
      grantId: grant.id,
      type: grant.resourceType,
      id: grant.resourceId,
      currency: null as string | null,
      total: null as string | null,
      validUntil: null as Date | null,
      signedAt: null as Date | null,
      signatureReference: null as string | null,
      items: [] as PortalDocumentView['items'],
      downloadable: false,
    };

    if (grant.resourceType === 'proposal') {
      const proposal = await prisma.proposal.findFirst({
        where: {
          id: grant.resourceId,
          organizationId: context.organizationId,
          deletedAt: null,
        },
        select: {
          title: true,
          number: true,
          status: true,
          currency: true,
          total: true,
          validUntil: true,
          items: {
            select: { description: true, quantity: true, unitPrice: true, amount: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });
      if (!proposal) continue;
      views.push({
        ...base,
        title: proposal.title,
        subtitle: proposal.number,
        status: proposal.status,
        currency: proposal.currency,
        total: proposal.total.toString(),
        validUntil: proposal.validUntil,
        items: proposal.items.map(serializeItem),
      });
      continue;
    }

    if (grant.resourceType === 'quotation') {
      const quotation = await prisma.quotation.findFirst({
        where: {
          id: grant.resourceId,
          organizationId: context.organizationId,
          deletedAt: null,
        },
        select: {
          title: true,
          number: true,
          status: true,
          currency: true,
          total: true,
          validUntil: true,
          items: {
            select: { description: true, quantity: true, unitPrice: true, amount: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });
      if (!quotation) continue;
      views.push({
        ...base,
        title: quotation.title,
        subtitle: quotation.number,
        status: quotation.status,
        currency: quotation.currency,
        total: quotation.total.toString(),
        validUntil: quotation.validUntil,
        items: quotation.items.map(serializeItem),
      });
      continue;
    }

    if (grant.resourceType === 'estimate') {
      const estimate = await prisma.estimate.findFirst({
        where: { id: grant.resourceId, organizationId: context.organizationId },
        select: {
          number: true,
          status: true,
          currency: true,
          total: true,
          validUntil: true,
          notes: true,
        },
      });
      if (!estimate) continue;
      views.push({
        ...base,
        title: `Estimate ${estimate.number}`,
        subtitle: estimate.number,
        status: estimate.status,
        currency: estimate.currency,
        total: estimate.total.toString(),
        validUntil: estimate.validUntil,
      });
      continue;
    }

    if (grant.resourceType === 'contract') {
      const contract = await prisma.contract.findFirst({
        where: { id: grant.resourceId, organizationId: context.organizationId },
        select: {
          title: true,
          status: true,
          signedAt: true,
          signatureReference: true,
        },
      });
      if (!contract) continue;
      views.push({
        ...base,
        title: contract.title,
        subtitle: null,
        status: contract.status,
        signedAt: contract.signedAt,
        signatureReference: contract.signatureReference,
        // Read-only: the audit-trail signature is displayed, never produced here.
        downloadable: false,
      });
      continue;
    }

    const document = await prisma.document.findFirst({
      where: { id: grant.resourceId, organizationId: context.organizationId },
      select: { title: true, type: true, version: true, fileAssetId: true },
    });
    if (!document) continue;
    views.push({
      ...base,
      title: document.title,
      subtitle: `${document.type} · v${document.version}`,
      status: null,
      downloadable: canDownload && Boolean(document.fileAssetId),
    });
  }

  return views;
}

function serializeItem(item: {
  description: string;
  quantity: unknown;
  unitPrice: unknown;
  amount: unknown;
}) {
  return {
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    amount: String(item.amount),
  };
}

interface PortalInvoiceRow {
  id: string;
  number: string;
  title: string;
  status: string;
  currency: string;
  subtotal: { toString(): string };
  tax: { toString(): string };
  total: { toString(): string };
  dueDate: Date | null;
  payments: Array<{ amount: { toString(): string }; paidAt: Date; method: string }>;
}

export interface PortalInvoiceView {
  id: string;
  number: string;
  title: string;
  status: string;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
  dueDate: Date | null;
  payments: Array<{ amount: string; paidAt: Date; method: string }>;
  outstanding: string;
}

/** Invoices shared with the client (requires the `viewInvoices` flag). */
export async function listPortalInvoices(): Promise<PortalInvoiceView[]> {
  const context = await requirePortalCapability('viewInvoices');
  const ids = await listGrantedResourceIds(context, 'invoice');
  if (ids.length === 0) return [];

  const invoices = (await prisma.invoice.findMany({
    where: { id: { in: ids }, organizationId: context.organizationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      currency: true,
      subtotal: true,
      tax: true,
      total: true,
      dueDate: true,
      payments: {
        select: { amount: true, paidAt: true, method: true },
        orderBy: { paidAt: 'desc' },
      },
    },
  })) as PortalInvoiceRow[];

  return invoices.map((invoice) => {
    const paid = invoice.payments.reduce(
      (sum: number, payment: { amount: unknown }) => sum + Number(payment.amount),
      0
    );
    return {
      id: invoice.id,
      number: invoice.number,
      title: invoice.title,
      status: invoice.status,
      currency: invoice.currency,
      subtotal: invoice.subtotal.toString(),
      tax: invoice.tax.toString(),
      total: invoice.total.toString(),
      dueDate: invoice.dueDate,
      payments: invoice.payments.map((payment) => ({
        amount: payment.amount.toString(),
        paidAt: payment.paidAt,
        method: payment.method,
      })),
      outstanding: Math.max(0, Number(invoice.total) - paid).toFixed(2),
    };
  });
}

/**
 * Download a granted file or the attachment of a granted document.
 *
 * Both paths require: an active portal identity, the `downloadFiles` capability,
 * a live grant, a resource that still exists in the client's organization, and a
 * stored path confined to the storage root.
 */
export async function downloadPortalFile(
  resourceType: 'file' | 'document',
  resourceId: string
): Promise<StoredFile> {
  const context = await requirePortalCapability('downloadFiles');
  await requireGrantedResource(context, resourceType, resourceId);

  if (resourceType === 'file') {
    const projectFile = await prisma.projectFile.findFirst({
      where: {
        id: resourceId,
        organizationId: context.organizationId,
        fileAsset: { organizationId: context.organizationId },
      },
      select: {
        fileAsset: { select: { storagePath: true, originalName: true, mimeType: true } },
      },
    });
    if (!projectFile?.fileAsset) throw codedError('Not found', 404);
    return readStoredFile(projectFile.fileAsset);
  }

  const document = await prisma.document.findFirst({
    where: {
      id: resourceId,
      organizationId: context.organizationId,
      fileAsset: { organizationId: context.organizationId },
    },
    select: {
      fileAsset: { select: { storagePath: true, originalName: true, mimeType: true } },
    },
  });
  if (!document?.fileAsset) throw codedError('Not found', 404);
  return readStoredFile(document.fileAsset);
}

export interface PortalNotificationView {
  id: string;
  type: string;
  read: boolean;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

/** The signed-in client's own notifications. */
export async function listPortalNotifications(): Promise<PortalNotificationView[]> {
  const context = await requirePortalAccess();

  const notifications = (await prisma.notification.findMany({
    where: { organizationId: context.organizationId, userId: context.userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, type: true, read: true, payload: true, createdAt: true },
  })) as Array<{
    id: string;
    type: string;
    read: boolean;
    payload: unknown;
    createdAt: Date;
  }>;

  return notifications.map((notification) => ({
    id: notification.id,
    type: notification.type,
    read: notification.read,
    payload: (notification.payload as Record<string, unknown> | null) ?? null,
    createdAt: notification.createdAt,
  }));
}

/** Mark one of the client's own notifications read. */
export async function markPortalNotificationRead(notificationId: string) {
  const context = await requirePortalAccess();

  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      organizationId: context.organizationId,
      userId: context.userId,
    },
    select: { id: true },
  });
  if (!notification) throw codedError('Not found', 404);

  await prisma.notification.update({
    where: { id: notification.id },
    data: { read: true },
  });

  return { id: notification.id, read: true };
}

/** Mark every notification of the client read. */
export async function markAllPortalNotificationsRead() {
  const context = await requirePortalAccess();

  const result = await prisma.notification.updateMany({
    where: { organizationId: context.organizationId, userId: context.userId, read: false },
    data: { read: true },
  });

  return { updated: result.count };
}

export interface PortalNotificationPreferenceView {
  channels: Record<string, boolean>;
  mutedTypes: string[];
}

/** Notification preferences of the signed-in client. */
export async function getPortalNotificationPreferences(): Promise<PortalNotificationPreferenceView> {
  const context = await requirePortalAccess();

  const preference = await prisma.notificationPreference.findUnique({
    where: {
      organizationId_userId: { organizationId: context.organizationId, userId: context.userId },
    },
  });

  return {
    channels: (preference?.channels as Record<string, boolean> | null) ?? { in_app: true },
    mutedTypes: preference?.mutedTypes ?? [],
  };
}

/** Update the client's own notification preferences. */
export async function updatePortalNotificationPreferences(input: unknown) {
  const context = await requirePortalAccess();

  const parsed = parsePreferenceInput(input);
  const preference = await prisma.notificationPreference.upsert({
    where: {
      organizationId_userId: { organizationId: context.organizationId, userId: context.userId },
    },
    create: {
      organizationId: context.organizationId,
      userId: context.userId,
      channels: parsed.channels as object,
      mutedTypes: parsed.mutedTypes,
    },
    update: {
      channels: parsed.channels as object,
      mutedTypes: parsed.mutedTypes,
    },
  });

  return {
    channels: (preference.channels as Record<string, boolean> | null) ?? {},
    mutedTypes: preference.mutedTypes,
  };
}

function parsePreferenceInput(input: unknown): {
  channels: Record<string, boolean>;
  mutedTypes: string[];
} {
  const record = (input ?? {}) as Record<string, unknown>;

  const channels: Record<string, boolean> = {};
  if (record.channels && typeof record.channels === 'object') {
    for (const [key, value] of Object.entries(record.channels as Record<string, unknown>)) {
      if (key === 'in_app' || key === 'email') channels[key] = value === true;
    }
  }

  const mutedTypes = Array.isArray(record.mutedTypes)
    ? record.mutedTypes
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];

  return { channels, mutedTypes };
}

/** True when the client would receive a notification of this type in-app. */
export async function portalNotificationAllowed(type: string): Promise<boolean> {
  const context = await requirePortalAccess();
  return isNotificationAllowed(context.organizationId, context.userId, type, 'in_app');
}
