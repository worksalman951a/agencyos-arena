'use server';

/**
 * Client approval requests.
 *
 * Flow:
 *   internal staff requests an approval on a resource the client already holds
 *     -> event "requested" + notification to the client
 *   client approves or requests changes
 *     -> identity + timestamp recorded on the row, one event appended
 *     -> internal requesters notified
 *
 * Rules enforced here:
 * - An approval can only target a resource that is actively granted to that
 *   client, and only the client's own access can answer it. A forged approval id
 *   from another client resolves to 404 because the lookup is scoped by the
 *   portal context's own client access id.
 * - Decisions are terminal: `approved` and `changes_requested` cannot be
 *   overwritten. A new round requires a new request, which keeps the recorded
 *   history truthful.
 * - This is an approval record, not a legally certified e-signature. The
 *   `Signature` audit trail stays internal and unchanged.
 */

import { prisma } from '@/lib/db';
import {
  codedError,
  requireGrantedResource,
  requirePortalAccess,
  requirePortalCapability,
  type PortalAccessContext,
} from '@/lib/portal/access-control';
import { writePortalAudit } from '@/lib/portal/audit';
import { notifyInternalStaff, notifyUser } from '@/lib/portal/notify';
import { requireInternalActor } from '@/lib/portal/internal-actor';
import { isPortalResourceType, type PortalResourceType } from '@/lib/portal/resource-registry';
import {
  clientApprovalCreateSchema,
  clientApprovalRespondSchema,
} from '@/lib/schemas/portal/client-portal.schema';

export interface ClientApprovalView {
  id: string;
  title: string;
  description: string | null;
  resourceType: string;
  resourceId: string;
  status: string;
  dueAt: Date | null;
  respondedAt: Date | null;
  responseNote: string | null;
  createdAt: Date;
  requestedBy: string | null;
  respondedBy: string | null;
}

function toView(approval: {
  id: string;
  title: string;
  description: string | null;
  resourceType: string;
  resourceId: string;
  status: string;
  dueAt: Date | null;
  respondedAt: Date | null;
  responseNote: string | null;
  createdAt: Date;
  requestedBy: string | null;
  respondedBy: string | null;
}): ClientApprovalView {
  return {
    id: approval.id,
    title: approval.title,
    description: approval.description,
    resourceType: approval.resourceType,
    resourceId: approval.resourceId,
    status: approval.status,
    dueAt: approval.dueAt,
    respondedAt: approval.respondedAt,
    responseNote: approval.responseNote,
    createdAt: approval.createdAt,
    requestedBy: approval.requestedBy,
    respondedBy: approval.respondedBy,
  };
}

interface ApprovalEventRow {
  id: string;
  action: string;
  actorType: string;
  note: string | null;
  createdAt: Date;
  actor: { name: string | null; email: string } | null;
}

interface InternalApprovalRow {
  id: string;
  title: string;
  description: string | null;
  resourceType: string;
  resourceId: string;
  status: string;
  dueAt: Date | null;
  respondedAt: Date | null;
  responseNote: string | null;
  createdAt: Date;
  requestedBy: string | null;
  respondedBy: string | null;
  clientAccessId: string;
  organizationId: string;
  clientAccess: { contact: { firstName: string | null; lastName: string } };
}

export interface ClientApprovalEventView {
  id: string;
  action: string;
  actorType: string;
  actorName: string | null;
  note: string | null;
  createdAt: Date;
}

/** Approval history, oldest first (append-only). */
export async function listApprovalEventsForClient(
  context: PortalAccessContext,
  approvalId: string
): Promise<ClientApprovalEventView[]> {
  const approval = await prisma.clientApproval.findFirst({
    where: {
      id: approvalId,
      clientAccessId: context.accessId,
      organizationId: context.organizationId,
    },
    select: { id: true },
  });
  if (!approval) throw codedError('Not found', 404);

  const events = (await prisma.clientApprovalEvent.findMany({
    where: { approvalId: approval.id, organizationId: context.organizationId },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { name: true, email: true } } },
  })) as ApprovalEventRow[];

  return events.map((event) => ({
    id: event.id,
    action: event.action,
    actorType: event.actorType,
    actorName:
      event.actorType === 'client'
        ? context.contactName
        : (event.actor?.name ?? event.actor?.email ?? null),
    note: event.note,
    createdAt: event.createdAt,
  }));
}

/** Approvals requested from the signed-in client (newest first). */
export async function listClientApprovals(): Promise<ClientApprovalView[]> {
  const context = await requirePortalAccess();

  const approvals = await prisma.clientApproval.findMany({
    where: { clientAccessId: context.accessId, organizationId: context.organizationId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  });

  return approvals.map(toView);
}

/** One approval of the signed-in client, with its history. */
export async function getClientApproval(approvalId: string) {
  const context = await requirePortalAccess();

  const approval = await prisma.clientApproval.findFirst({
    where: {
      id: approvalId,
      clientAccessId: context.accessId,
      organizationId: context.organizationId,
    },
  });
  if (!approval) throw codedError('Not found', 404);

  return {
    approval: toView(approval),
    events: await listApprovalEventsForClient(context, approval.id),
  };
}

/**
 * Client decision on an approval request.
 *
 * Requires the `approve` capability and a still-pending request. The responding
 * identity and timestamp are written from the session, never from the payload.
 */
export async function respondToClientApproval(approvalId: string, input: unknown) {
  const parsed = clientApprovalRespondSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const context = await requirePortalCapability('approve');

  const approval = await prisma.clientApproval.findFirst({
    where: {
      id: approvalId,
      clientAccessId: context.accessId,
      organizationId: context.organizationId,
    },
  });
  if (!approval) throw codedError('Not found', 404);
  if (approval.status !== 'pending') {
    throw codedError('This approval request has already been answered', 409);
  }

  // The grant must still be live: revoking a share withdraws the ability to act.
  if (isPortalResourceType(approval.resourceType)) {
    await requireGrantedResource(context, approval.resourceType, approval.resourceId, {
      action: 'approve',
    });
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx: typeof prisma) => {
    // Conditional update: only a pending row may be decided, so two concurrent
    // responses cannot both be recorded.
    const claimed = await tx.clientApproval.updateMany({
      where: { id: approval.id, status: 'pending' },
      data: {
        status: parsed.data.decision,
        respondedBy: context.userId,
        respondedAt: now,
        responseNote: parsed.data.note ?? null,
      },
    });
    if (claimed.count !== 1) {
      throw codedError('This approval request has already been answered', 409);
    }

    await tx.clientApprovalEvent.create({
      data: {
        organizationId: context.organizationId,
        approvalId: approval.id,
        actorType: 'client',
        actorUserId: context.userId,
        action: parsed.data.decision,
        note: parsed.data.note ?? null,
      },
    });

    return tx.clientApproval.findUniqueOrThrow({ where: { id: approval.id } });
  });

  await writePortalAudit({
    organizationId: context.organizationId,
    actorId: context.userId,
    actorName: context.email,
    action: `client.approval.${parsed.data.decision}`,
    entityType: 'ClientApproval',
    entityId: approval.id,
    before: { status: 'pending' },
    after: { status: parsed.data.decision },
    metadata: {
      actorType: 'client',
      resourceType: approval.resourceType,
      resourceId: approval.resourceId,
    },
  });

  await notifyInternalStaff({
    organizationId: context.organizationId,
    permissionCode: 'client.approval.read',
    type: 'client.approval.responded',
    payload: {
      approvalId: approval.id,
      decision: parsed.data.decision,
      clientName: context.contactName,
      title: approval.title,
    },
    dedupeKey: `client-approval-response:${approval.id}:${parsed.data.decision}`,
  });

  return toView(updated);
}

// ---------------------------------------------------------------------------
// Internal side
// ---------------------------------------------------------------------------

export interface InternalClientApprovalView extends ClientApprovalView {
  clientAccessId: string;
  clientName: string;
  organizationId: string;
}

/** All client approvals of the actor's organization. */
export async function listClientApprovalsForOrganization(): Promise<InternalClientApprovalView[]> {
  const actor = await requireInternalActor('client.approval.read');

  const approvals = (await prisma.clientApproval.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      clientAccess: {
        select: { contact: { select: { firstName: true, lastName: true } } },
      },
    },
  })) as InternalApprovalRow[];

  return approvals.map((approval) => ({
    ...toView(approval),
    clientAccessId: approval.clientAccessId,
    clientName: [approval.clientAccess.contact.firstName, approval.clientAccess.contact.lastName]
      .filter(Boolean)
      .join(' ')
      .trim(),
    organizationId: approval.organizationId,
  }));
}

/**
 * Request an approval from a client.
 *
 * The client access must belong to the actor's organization and be active, and
 * the resource must already be shared with that client - requesting approval on
 * an unshared resource would create a request the client could not open.
 */
export async function createClientApprovalRequest(input: unknown) {
  const parsed = clientApprovalCreateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const actor = await requireInternalActor('client.approval.create');

  const access = await prisma.clientAccess.findFirst({
    where: { id: parsed.data.clientAccessId, organizationId: actor.organizationId },
    select: { id: true, userId: true, status: true, canApprove: true },
  });
  if (!access) throw codedError('Client access not found', 404);
  if (access.status !== 'active') {
    throw codedError('This client access is not active', 400);
  }
  if (!access.canApprove) {
    throw codedError('This client does not have the approve capability', 400);
  }

  const { resourceType, resourceId } = parsed.data;
  const grant = await prisma.clientResourceGrant.findFirst({
    where: {
      organizationId: actor.organizationId,
      clientAccessId: access.id,
      resourceType,
      resourceId,
      revokedAt: null,
    },
    select: { id: true, canApprove: true },
  });
  if (!grant) throw codedError('Share the resource with this client first', 400);
  if (!grant.canApprove) {
    throw codedError('This share does not allow approvals', 400);
  }

  const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;

  const approval = await prisma.$transaction(async (tx: typeof prisma) => {
    const created = await tx.clientApproval.create({
      data: {
        organizationId: actor.organizationId,
        clientAccessId: access.id,
        resourceType,
        resourceId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        status: 'pending',
        dueAt,
        requestedBy: actor.userId,
      },
    });

    await tx.clientApprovalEvent.create({
      data: {
        organizationId: actor.organizationId,
        approvalId: created.id,
        actorType: 'internal',
        actorUserId: actor.userId,
        action: 'requested',
        note: parsed.data.description ?? null,
      },
    });

    return created;
  });

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: 'client.approval.create',
    entityType: 'ClientApproval',
    entityId: approval.id,
    after: {
      clientAccessId: access.id,
      resourceType,
      resourceId,
      title: parsed.data.title,
      dueAt,
    },
  });

  await notifyUser({
    organizationId: actor.organizationId,
    userId: access.userId,
    type: 'client.approval.requested',
    payload: {
      approvalId: approval.id,
      title: parsed.data.title,
      message: `Your approval was requested: ${parsed.data.title}`,
    },
    dedupeKey: `client-approval-requested:${approval.id}`,
  });

  return toView(approval);
}

/** Cancel a pending approval request (internal). */
export async function cancelClientApprovalRequest(approvalId: string) {
  const actor = await requireInternalActor('client.approval.create');

  const approval = await prisma.clientApproval.findFirst({
    where: { id: approvalId, organizationId: actor.organizationId },
    select: { id: true, status: true },
  });
  if (!approval) throw codedError('Not found', 404);
  if (approval.status !== 'pending') {
    throw codedError('Only pending approvals can be cancelled', 400);
  }

  const updated = await prisma.$transaction(async (tx: typeof prisma) => {
    const claimed = await tx.clientApproval.updateMany({
      where: { id: approval.id, status: 'pending' },
      data: { status: 'cancelled' },
    });
    if (claimed.count !== 1) {
      throw codedError('This approval request has already been answered', 409);
    }
    await tx.clientApprovalEvent.create({
      data: {
        organizationId: actor.organizationId,
        approvalId: approval.id,
        actorType: 'internal',
        actorUserId: actor.userId,
        action: 'cancelled',
      },
    });
    return tx.clientApproval.findUniqueOrThrow({ where: { id: approval.id } });
  });

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: 'client.approval.cancel',
    entityType: 'ClientApproval',
    entityId: approval.id,
    before: { status: 'pending' },
    after: { status: 'cancelled' },
  });

  return toView(updated);
}

export type { PortalResourceType };
