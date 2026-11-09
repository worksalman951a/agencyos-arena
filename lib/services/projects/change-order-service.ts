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
}

const CHANGE_ORDER_STATUSES = ['pending', 'approved', 'rejected'];

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
  approver: { id: string; name: string | null; email: string | null } | null;
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

/**
 * List change orders.
 *
 * `projectId` is optional: passing it lists one project's change orders (after
 * verifying the project belongs to the caller's organization); omitting it
 * lists the organization's change orders, which is what the "Change Orders"
 * page needs. Both paths stay organization-scoped.
 */
export async function listChangeOrders(projectId?: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'change.order.read');

  if (projectId) {
    // Verify project belongs to org
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!project) {
      const error = new Error('Project not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const changeOrders = await prisma.changeOrder.findMany({
    where: projectId ? { projectId, organizationId } : { organizationId },
    include: {
      approver: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return changeOrders.map((co: ChangeOrderRecord) => ({
    id: co.id,
    organizationId: co.organizationId,
    projectId: co.projectId,
    description: co.description,
    amount: co.amount.toString(),
    status: co.status,
    approvedBy: co.approvedBy,
    createdAt: co.createdAt,
    updatedAt: co.updatedAt,
  }));
}

export async function createChangeOrder(input: ChangeOrderCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'change.order.create');

  // Verify project belongs to org
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId },
  });

  if (!project) {
    const error = new Error('Project not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const changeOrder = await prisma.changeOrder.create({
    data: {
      organizationId,
      projectId: input.projectId,
      description: input.description,
      amount: Number(input.amount),
      status: input.status,
      approvedBy: input.approvedBy ?? null,
    },
  });

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

  return {
    id: changeOrder.id,
    organizationId: changeOrder.organizationId,
    projectId: changeOrder.projectId,
    description: changeOrder.description,
    amount: changeOrder.amount.toString(),
    status: changeOrder.status,
    approvedBy: changeOrder.approvedBy,
    createdAt: changeOrder.createdAt,
    updatedAt: changeOrder.updatedAt,
  };
}

export async function updateChangeOrder(id: string, input: ChangeOrderUpdateInput) {
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

  if (input.status !== undefined && !CHANGE_ORDER_STATUSES.includes(input.status)) {
    const error = new Error(`Invalid change order status: ${input.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const changeOrder = await prisma.changeOrder.update({
    where: { id },
    data: {
      description: input.description ?? existing.description,
      amount: input.amount !== undefined ? Number(input.amount) : existing.amount,
      status: input.status ?? existing.status,
      approvedBy: input.approvedBy !== undefined ? input.approvedBy : existing.approvedBy,
    },
  });

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

  return {
    id: changeOrder.id,
    organizationId: changeOrder.organizationId,
    projectId: changeOrder.projectId,
    description: changeOrder.description,
    amount: changeOrder.amount.toString(),
    status: changeOrder.status,
    approvedBy: changeOrder.approvedBy,
    createdAt: changeOrder.createdAt,
    updatedAt: changeOrder.updatedAt,
  };
}

export async function deleteChangeOrder(id: string) {
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
    before: { id: existing.id, projectId: existing.projectId, status: existing.status },
    after: null,
    organizationId,
  });

  return { id };
}
