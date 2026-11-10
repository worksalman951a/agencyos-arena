'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  ChangeOrderCreateInput,
  ChangeOrderUpdateInput,
} from '@/lib/schemas/projects/change-order.schema';

export interface ChangeOrderResponse {
  id: string;
  organizationId: string;
  projectId: string;
  description: string;
  amount: string;
  status: string;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  project?: { id: string; name: string } | null;
  approver?: { id: string; name: string | null; email: string | null } | null;
}

const CHANGE_ORDER_STATUSES = ['pending', 'approved', 'rejected'] as const;

const VALID_CHANGE_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};

interface ChangeOrderRecord {
  id: string;
  organizationId: string;
  projectId: string;
  description: string;
  amount: { toString: () => string };
  status: string;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  project?: { id: string; name: string } | null;
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    const error = new Error('Unauthenticated') as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }

  const user = result.user as { role?: string; organizationId?: string };
  const { organizationId } = await requireOrganization(result.user.id);
  return {
    userId: result.user.id,
    organizationId,
    email: result.user.email ?? '',
    role: user.role ?? 'employee',
  };
}

async function createAuditLog({
  actorId,
  actorName,
  action,
  entityType,
  entityId,
  before,
  after,
  metadata,
  organizationId,
}: {
  actorId: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  organizationId: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorId,
      actorName,
      action,
      entityType,
      entityId,
      before: before ?? null,
      after: after ?? null,
      metadata: metadata ?? null,
      organizationId,
    },
  });
}

function parseChangeOrderAmount(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (!trimmed || Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    const error = new Error('Amount must be a valid number') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function serializeChangeOrder(
  co: ChangeOrderRecord,
  approverMap?: Map<string, { id: string; name: string | null; email: string | null }>
): ChangeOrderResponse {
  return {
    id: co.id,
    organizationId: co.organizationId,
    projectId: co.projectId,
    description: co.description,
    amount: co.amount.toString(),
    status: co.status,
    approvedBy: co.approvedBy,
    createdAt: co.createdAt,
    updatedAt: co.updatedAt,
    project: co.project ?? null,
    approver: co.approvedBy ? (approverMap?.get(co.approvedBy) ?? null) : null,
  };
}

/**
 * List change orders.
 *
 * `projectId` is optional: passing it lists one project's change orders (after
 * verifying the project belongs to the caller's organization); omitting it
 * lists the organization's change orders. Both paths stay organization-scoped.
 */
export async function listChangeOrders(projectId?: string): Promise<ChangeOrderResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'change.order.read');

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!project) {
      const error = new Error('Project not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const changeOrders = (await prisma.changeOrder.findMany({
    where: projectId ? { projectId, organizationId } : { organizationId },
    include: {
      project: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })) as ChangeOrderRecord[];

  const approverIds = Array.from(
    new Set(changeOrders.map((co) => co.approvedBy).filter((id): id is string => Boolean(id)))
  );

  const approvers =
    approverIds.length > 0
      ? ((await prisma.user.findMany({
          where: { id: { in: approverIds }, organizationId },
          select: { id: true, name: true, email: true },
        })) as Array<{ id: string; name: string | null; email: string | null }>)
      : [];

  const approverMap = new Map(approvers.map((u) => [u.id, u]));

  return changeOrders.map((co) => serializeChangeOrder(co, approverMap));
}

export async function getChangeOrder(id: string): Promise<ChangeOrderResponse> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'change.order.read');

  const co = (await prisma.changeOrder.findFirst({
    where: { id, organizationId },
    include: {
      project: { select: { id: true, name: true } },
    },
  })) as ChangeOrderRecord | null;

  if (!co) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const approver = co.approvedBy
    ? ((await prisma.user.findFirst({
        where: { id: co.approvedBy, organizationId },
        select: { id: true, name: true, email: true },
      })) as { id: string; name: string | null; email: string | null } | null)
    : null;

  const approverMap = new Map<string, { id: string; name: string | null; email: string | null }>();
  if (approver) approverMap.set(approver.id, approver);

  return serializeChangeOrder(co, approverMap);
}

export async function createChangeOrder(
  input: ChangeOrderCreateInput
): Promise<ChangeOrderResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'change.order.create');

  if (!(CHANGE_ORDER_STATUSES as readonly string[]).includes(input.status)) {
    const error = new Error(`Invalid change order status: ${input.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId, deletedAt: null },
  });

  if (!project) {
    const error = new Error('Project not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  let resolvedApprovedBy: string | null = input.approvedBy ?? null;
  if (resolvedApprovedBy) {
    const approver = await prisma.user.findFirst({
      where: { id: resolvedApprovedBy, organizationId },
    });
    if (!approver) {
      const error = new Error('Approver not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  } else if (input.status === 'approved') {
    resolvedApprovedBy = userId;
  }

  const parsedAmount = parseChangeOrderAmount(input.amount);

  const changeOrder = (await prisma.changeOrder.create({
    data: {
      organizationId,
      projectId: input.projectId,
      description: input.description.trim(),
      amount: parsedAmount,
      status: input.status,
      approvedBy: resolvedApprovedBy,
    },
    include: {
      project: { select: { id: true, name: true } },
    },
  })) as ChangeOrderRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'change.order.create',
    entityType: 'ChangeOrder',
    entityId: changeOrder.id,
    after: {
      id: changeOrder.id,
      projectId: changeOrder.projectId,
      amount: changeOrder.amount.toString(),
      status: changeOrder.status,
    },
    organizationId,
  });

  const approver = resolvedApprovedBy
    ? ((await prisma.user.findFirst({
        where: { id: resolvedApprovedBy, organizationId },
        select: { id: true, name: true, email: true },
      })) as { id: string; name: string | null; email: string | null } | null)
    : null;
  const approverMap = new Map<string, { id: string; name: string | null; email: string | null }>();
  if (approver) approverMap.set(approver.id, approver);

  return serializeChangeOrder(changeOrder, approverMap);
}

export async function updateChangeOrder(
  id: string,
  input: ChangeOrderUpdateInput
): Promise<ChangeOrderResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'change.order.update');

  const existing = await prisma.changeOrder.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (
    input.status !== undefined &&
    !(CHANGE_ORDER_STATUSES as readonly string[]).includes(input.status)
  ) {
    const error = new Error(`Invalid change order status: ${input.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  if (input.status !== undefined && input.status !== existing.status) {
    const allowed = VALID_CHANGE_ORDER_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      const error = new Error(
        `Invalid status transition from ${existing.status} to ${input.status}`
      ) as Error & { statusCode?: number };
      error.statusCode = 400;
      throw error;
    }
  }

  let resolvedApprovedBy = input.approvedBy !== undefined ? input.approvedBy : existing.approvedBy;

  if (resolvedApprovedBy) {
    const approver = await prisma.user.findFirst({
      where: { id: resolvedApprovedBy, organizationId },
    });
    if (!approver) {
      const error = new Error('Approver not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  } else if (input.status === 'approved' && existing.status !== 'approved') {
    resolvedApprovedBy = userId;
  }

  const nextAmount =
    input.amount !== undefined ? parseChangeOrderAmount(input.amount) : existing.amount;

  const changeOrder = (await prisma.changeOrder.update({
    where: { id },
    data: {
      description:
        input.description !== undefined ? input.description.trim() : existing.description,
      amount: nextAmount,
      status: input.status ?? existing.status,
      approvedBy: resolvedApprovedBy,
    },
    include: {
      project: { select: { id: true, name: true } },
    },
  })) as ChangeOrderRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'change.order.update',
    entityType: 'ChangeOrder',
    entityId: changeOrder.id,
    before: {
      id: existing.id,
      status: existing.status,
      amount: existing.amount.toString(),
    },
    after: {
      id: changeOrder.id,
      status: changeOrder.status,
      amount: changeOrder.amount.toString(),
    },
    organizationId,
  });

  const approver = resolvedApprovedBy
    ? ((await prisma.user.findFirst({
        where: { id: resolvedApprovedBy, organizationId },
        select: { id: true, name: true, email: true },
      })) as { id: string; name: string | null; email: string | null } | null)
    : null;
  const approverMap = new Map<string, { id: string; name: string | null; email: string | null }>();
  if (approver) approverMap.set(approver.id, approver);

  return serializeChangeOrder(changeOrder, approverMap);
}

export async function deleteChangeOrder(id: string): Promise<{ id: string }> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'change.order.delete');

  const existing = await prisma.changeOrder.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  await prisma.changeOrder.delete({
    where: { id },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'change.order.delete',
    entityType: 'ChangeOrder',
    entityId: id,
    before: { id: existing.id, projectId: existing.projectId, amount: existing.amount.toString() },
    after: null,
    organizationId,
  });

  return { id };
}
