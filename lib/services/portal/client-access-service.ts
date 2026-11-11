'use server';

/**
 * Client-portal access administration (internal team side).
 *
 * Responsibilities:
 * - list portal identities for the caller's organization;
 * - tune capability flags (never roles/permissions of the internal RBAC);
 * - suspend (reversible) and revoke (terminal, invalidates sessions);
 * - share or unshare individual resources with one client.
 *
 * Every query is filtered by the actor's organization, and every mutation is
 * audited. A client access id from another tenant resolves to "not found".
 */

import { prisma } from '@/lib/db';
import { codedError } from '@/lib/portal/access-control';
import { writePortalAudit } from '@/lib/portal/audit';
import { notifyUser } from '@/lib/portal/notify';
import { requireInternalActor } from '@/lib/portal/internal-actor';
import { findResourceInOrganization } from '@/lib/portal/resource-lookup';
import {
  canApprove as resourceAcceptsApprovals,
  canCommentOn as resourceAcceptsComments,
  isPortalResourceType,
  type PortalResourceType,
} from '@/lib/portal/resource-registry';
import {
  clientAccessRevokeSchema,
  clientAccessUpdateSchema,
  clientGrantCreateSchema,
} from '@/lib/schemas/portal/client-portal.schema';

interface ClientAccessRow {
  id: string;
  userId: string;
  contactId: string;
  status: string;
  role: string;
  canViewInvoices: boolean;
  canDownloadFiles: boolean;
  canComment: boolean;
  canApprove: boolean;
  lastAccessAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  suspendedAt: Date | null;
  user: { id: string; email: string; status: string };
  contact: { firstName: string | null; lastName: string };
  _count: { grants: number; approvals: number };
}

export interface ClientAccessSummary {
  id: string;
  userId: string;
  email: string;
  contactId: string;
  contactName: string;
  status: string;
  role: string;
  canViewInvoices: boolean;
  canDownloadFiles: boolean;
  canComment: boolean;
  canApprove: boolean;
  lastAccessAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  suspendedAt: Date | null;
  grantCount: number;
  pendingApprovalCount: number;
}

/** List portal identities in the caller's organization. */
export async function listClientAccesses(): Promise<ClientAccessSummary[]> {
  const actor = await requireInternalActor('client.access.read');

  const accesses = (await prisma.clientAccess.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      user: { select: { id: true, email: true, status: true } },
      contact: { select: { firstName: true, lastName: true } },
      _count: {
        select: {
          grants: { where: { revokedAt: null } },
          approvals: { where: { status: 'pending' } },
        },
      },
    },
  })) as ClientAccessRow[];

  return accesses.map((access) => ({
    id: access.id,
    userId: access.userId,
    email: access.user.email,
    contactId: access.contactId,
    contactName: [access.contact.firstName, access.contact.lastName]
      .filter(Boolean)
      .join(' ')
      .trim(),
    status: access.status,
    role: access.role,
    canViewInvoices: access.canViewInvoices,
    canDownloadFiles: access.canDownloadFiles,
    canComment: access.canComment,
    canApprove: access.canApprove,
    lastAccessAt: access.lastAccessAt,
    createdAt: access.createdAt,
    revokedAt: access.revokedAt,
    suspendedAt: access.suspendedAt,
    grantCount: access._count.grants,
    pendingApprovalCount: access._count.approvals,
  }));
}

async function assertAccessInOrganization(accessId: string, organizationId: string) {
  const access = await prisma.clientAccess.findFirst({
    where: { id: accessId, organizationId },
    select: {
      id: true,
      userId: true,
      status: true,
      role: true,
      canViewInvoices: true,
      canDownloadFiles: true,
      canComment: true,
      canApprove: true,
      contactId: true,
    },
  });
  if (!access) throw codedError('Not found', 404);
  return access;
}

/**
 * Update capability flags, or suspend/reactivate an access.
 *
 * Revoked access is terminal: it can only be re-granted by issuing a new
 * invitation, so a mistake in this endpoint cannot resurrect a removed client.
 */
export async function updateClientAccess(accessId: string, input: unknown) {
  const parsed = clientAccessUpdateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const actor = await requireInternalActor('client.access.manage');
  const access = await assertAccessInOrganization(accessId, actor.organizationId);
  if (access.status === 'revoked') {
    throw codedError('Revoked access cannot be modified; invite the client again', 400);
  }

  const now = new Date();
  const data: Record<string, unknown> = { ...parsed.data };

  if (parsed.data.status === 'active') {
    data.suspendedAt = null;
  }
  if (parsed.data.status === 'suspended') {
    data.suspendedAt = now;
  }

  const updated = await prisma.clientAccess.update({
    where: { id: access.id },
    data,
  });

  // A suspended client loses access immediately: kill live sessions.
  if (parsed.data.status === 'suspended') {
    await prisma.session.deleteMany({ where: { userId: access.userId } });
  }

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: parsed.data.status === 'suspended' ? 'client.access.suspend' : 'client.access.update',
    entityType: 'ClientAccess',
    entityId: access.id,
    before: {
      status: access.status,
      role: access.role,
      canViewInvoices: access.canViewInvoices,
      canDownloadFiles: access.canDownloadFiles,
      canComment: access.canComment,
      canApprove: access.canApprove,
    },
    after: parsed.data as Record<string, unknown>,
  });

  return { id: updated.id, status: updated.status };
}

/**
 * Revoke portal access permanently.
 *
 * Deletes the client's sessions (immediate logout), disables the underlying user
 * row, and marks the access revoked. Historical records - grants, approvals,
 * comments, audit entries - are preserved for the record.
 */
export async function revokeClientAccess(accessId: string, input: unknown = {}) {
  const parsed = clientAccessRevokeSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const actor = await requireInternalActor('client.access.manage');
  const access = await assertAccessInOrganization(accessId, actor.organizationId);
  if (access.status === 'revoked') {
    throw codedError('Access is already revoked', 400);
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx: typeof prisma) => {
    const revoked = await tx.clientAccess.update({
      where: { id: access.id },
      data: { status: 'revoked', revokedAt: now },
    });

    // Invalidate every live session for this identity.
    const sessions = await tx.session.deleteMany({ where: { userId: access.userId } });

    // Disable the login itself; Better Auth cannot mint a usable session for a
    // disabled account, and the portal guard re-checks both rows on every call.
    await tx.user.update({
      where: { id: access.userId },
      data: { status: 'disabled' },
    });

    // Grants are closed out so a future re-invitation starts from least
    // privilege rather than inheriting the old share list.
    await tx.clientResourceGrant.updateMany({
      where: { clientAccessId: access.id, revokedAt: null },
      data: { revokedAt: now, revokedBy: actor.userId },
    });

    // Pending approvals can no longer be answered.
    await tx.clientApproval.updateMany({
      where: { clientAccessId: access.id, status: 'pending' },
      data: { status: 'cancelled' },
    });

    return { revoked, sessionsRemoved: sessions.count };
  });

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: 'client.access.revoke',
    entityType: 'ClientAccess',
    entityId: access.id,
    before: { status: access.status },
    after: { status: 'revoked', sessionsRemoved: result.sessionsRemoved },
    metadata: parsed.data.reason ? { reason: parsed.data.reason } : null,
  });

  return { id: result.revoked.id, status: result.revoked.status };
}

export interface ClientGrantSummary {
  id: string;
  resourceType: string;
  resourceId: string;
  title: string;
  status: string | null;
  canComment: boolean;
  canApprove: boolean;
  note: string | null;
  sharedAt: Date;
  revokedAt: Date | null;
}

/** Grants for one client access. */
export async function listClientGrants(accessId: string): Promise<ClientGrantSummary[]> {
  const actor = await requireInternalActor('client.access.read');
  await assertAccessInOrganization(accessId, actor.organizationId);

  const grants = await prisma.clientResourceGrant.findMany({
    where: { clientAccessId: accessId, organizationId: actor.organizationId },
    orderBy: { sharedAt: 'desc' },
    take: 500,
  });

  const summaries: ClientGrantSummary[] = [];
  for (const grant of grants) {
    if (!isPortalResourceType(grant.resourceType)) continue;
    const resource = await findResourceInOrganization(
      grant.resourceType,
      grant.resourceId,
      actor.organizationId
    );
    summaries.push({
      id: grant.id,
      resourceType: grant.resourceType,
      resourceId: grant.resourceId,
      title: resource?.title ?? 'Resource no longer available',
      status: resource?.status ?? null,
      canComment: grant.canComment,
      canApprove: grant.canApprove,
      note: grant.note,
      sharedAt: grant.sharedAt,
      revokedAt: grant.revokedAt,
    });
  }
  return summaries;
}

/**
 * Share a resource with a client.
 *
 * The resource must exist in the actor's organization - a foreign id is a 404 -
 * and the type must be one the portal can render. Re-sharing a previously
 * revoked resource revives the same row so the unique index keeps one share
 * record per (client, resource).
 */
export async function shareResourceWithClient(accessId: string, input: unknown) {
  const parsed = clientGrantCreateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const actor = await requireInternalActor('client.access.manage');
  const access = await assertAccessInOrganization(accessId, actor.organizationId);
  if (access.status === 'revoked') {
    throw codedError('Revoked access cannot receive new shares', 400);
  }

  const { resourceType, resourceId } = parsed.data;
  const resource = await findResourceInOrganization(resourceType, resourceId, actor.organizationId);
  if (!resource) throw codedError('Resource not found', 404);

  const canComment = (parsed.data.canComment ?? true) && resourceAcceptsComments(resourceType);
  const canApprove = (parsed.data.canApprove ?? false) && resourceAcceptsApprovals(resourceType);

  const grant = await prisma.clientResourceGrant.upsert({
    where: {
      clientAccessId_resourceType_resourceId: {
        clientAccessId: access.id,
        resourceType,
        resourceId,
      },
    },
    create: {
      organizationId: actor.organizationId,
      clientAccessId: access.id,
      resourceType,
      resourceId,
      canComment,
      canApprove,
      note: parsed.data.note ?? null,
      sharedBy: actor.userId,
    },
    update: {
      canComment,
      canApprove,
      note: parsed.data.note ?? null,
      sharedBy: actor.userId,
      sharedAt: new Date(),
      revokedAt: null,
      revokedBy: null,
    },
  });

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: 'client.share.create',
    entityType: 'ClientResourceGrant',
    entityId: grant.id,
    after: { clientAccessId: access.id, resourceType, resourceId, canComment, canApprove },
  });

  await notifyUser({
    organizationId: actor.organizationId,
    userId: access.userId,
    type: 'client.share.created',
    payload: {
      resourceType,
      resourceId,
      title: resource.title,
      message: `A new item was shared with you: ${resource.title}`,
    },
    dedupeKey: `client-share:${grant.id}:${grant.sharedAt.toISOString()}`,
  });

  return {
    id: grant.id,
    resourceType: grant.resourceType,
    resourceId: grant.resourceId,
    canComment: grant.canComment,
    canApprove: grant.canApprove,
    sharedAt: grant.sharedAt,
  };
}

/** Revoke one share. */
export async function revokeClientGrant(accessId: string, grantId: string) {
  const actor = await requireInternalActor('client.access.manage');
  await assertAccessInOrganization(accessId, actor.organizationId);

  const grant = await prisma.clientResourceGrant.findFirst({
    where: { id: grantId, clientAccessId: accessId, organizationId: actor.organizationId },
  });
  if (!grant) throw codedError('Not found', 404);
  if (grant.revokedAt) return { id: grant.id, revokedAt: grant.revokedAt };

  const now = new Date();
  const revoked = await prisma.clientResourceGrant.update({
    where: { id: grant.id },
    data: { revokedAt: now, revokedBy: actor.userId },
  });

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: 'client.share.revoke',
    entityType: 'ClientResourceGrant',
    entityId: grant.id,
    before: { revokedAt: null },
    after: { revokedAt: now },
  });

  return { id: revoked.id, revokedAt: revoked.revokedAt };
}

/**
 * Grantable resources for the sharing UI: projects, proposals, quotations,
 * estimates, contracts, documents, invoices and project files of this
 * organization, newest first.
 */
export async function listShareableResources(type?: PortalResourceType) {
  const actor = await requireInternalActor('client.access.read');
  const organizationId = actor.organizationId;
  const wanted = type ?? null;

  const results: Array<{
    type: PortalResourceType;
    id: string;
    title: string;
    status: string | null;
  }> = [];

  if (!wanted || wanted === 'project') {
    const projects = await prisma.project.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    results.push(
      ...projects.map((project: { id: string; name: string; status: string }) => ({
        type: 'project' as const,
        id: project.id,
        title: project.name,
        status: project.status,
      }))
    );
  }

  if (!wanted || wanted === 'proposal') {
    const proposals = await prisma.proposal.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, title: true, number: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    results.push(
      ...proposals.map(
        (proposal: { id: string; title: string; number: string; status: string }) => ({
          type: 'proposal' as const,
          id: proposal.id,
          title: `${proposal.number} — ${proposal.title}`,
          status: proposal.status,
        })
      )
    );
  }

  if (!wanted || wanted === 'quotation') {
    const quotations = await prisma.quotation.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, title: true, number: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    results.push(
      ...quotations.map(
        (quotation: { id: string; title: string; number: string; status: string }) => ({
          type: 'quotation' as const,
          id: quotation.id,
          title: `${quotation.number} — ${quotation.title}`,
          status: quotation.status,
        })
      )
    );
  }

  if (!wanted || wanted === 'estimate') {
    const estimates = await prisma.estimate.findMany({
      where: { organizationId },
      select: { id: true, number: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    results.push(
      ...estimates.map((estimate: { id: string; number: string; status: string }) => ({
        type: 'estimate' as const,
        id: estimate.id,
        title: `Estimate ${estimate.number}`,
        status: estimate.status,
      }))
    );
  }

  if (!wanted || wanted === 'contract') {
    const contracts = await prisma.contract.findMany({
      where: { organizationId },
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    results.push(
      ...contracts.map((contract: { id: string; title: string; status: string }) => ({
        type: 'contract' as const,
        id: contract.id,
        title: contract.title,
        status: contract.status,
      }))
    );
  }

  if (!wanted || wanted === 'document') {
    const documents = await prisma.document.findMany({
      where: { organizationId },
      select: { id: true, title: true, type: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    results.push(
      ...documents.map((document: { id: string; title: string; type: string }) => ({
        type: 'document' as const,
        id: document.id,
        title: `${document.title} (${document.type})`,
        status: null,
      }))
    );
  }

  if (!wanted || wanted === 'invoice') {
    const invoices = await prisma.invoice.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, title: true, number: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    results.push(
      ...invoices.map((invoice: { id: string; title: string; number: string; status: string }) => ({
        type: 'invoice' as const,
        id: invoice.id,
        title: `${invoice.number} — ${invoice.title}`,
        status: invoice.status,
      }))
    );
  }

  if (!wanted || wanted === 'file') {
    const files = await prisma.projectFile.findMany({
      where: { organizationId, fileAsset: { organizationId } },
      select: {
        id: true,
        fileAsset: { select: { originalName: true } },
        project: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    results.push(
      ...files.map(
        (file: { id: string; fileAsset: { originalName: string }; project: { name: string } }) => ({
          type: 'file' as const,
          id: file.id,
          title: `${file.fileAsset.originalName} — ${file.project.name}`,
          status: null,
        })
      )
    );
  }

  return results;
}
