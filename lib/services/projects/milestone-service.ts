'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  MILESTONE_STATUS_VALUES,
  MilestoneCreateInput,
  MilestoneUpdateInput,
} from '@/lib/schemas/projects/milestone.schema';

export interface MilestoneResponse {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  dueDate: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const MILESTONE_STATUSES: readonly string[] = MILESTONE_STATUS_VALUES;

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
  organizationId,
}: {
  actorId: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
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
      metadata: null,
      organizationId,
    },
  });
}

function parseDueDate(value: string): Date {
  const parsed = new Date(value.trim());
  if (!value.trim() || Number.isNaN(parsed.getTime())) {
    const error = new Error('Invalid dueDate') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

export async function listMilestones(projectId: string): Promise<MilestoneResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.read');

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
  });
  if (!project) {
    const error = new Error('Project not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return prisma.milestone.findMany({
    where: { projectId, organizationId },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function createMilestone(input: MilestoneCreateInput): Promise<MilestoneResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.update');

  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId, deletedAt: null },
  });
  if (!project) {
    const error = new Error('Project not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (!MILESTONE_STATUSES.includes(input.status)) {
    const error = new Error(`Invalid milestone status: ${input.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const milestone = await prisma.milestone.create({
    data: {
      organizationId,
      projectId: input.projectId,
      name: input.name.trim(),
      dueDate: input.dueDate ? parseDueDate(input.dueDate) : null,
      status: input.status,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'milestone.create',
    entityType: 'Milestone',
    entityId: milestone.id,
    after: {
      id: milestone.id,
      projectId: milestone.projectId,
      name: milestone.name,
      status: milestone.status,
    },
    organizationId,
  });

  return milestone;
}

export async function updateMilestone(
  id: string,
  input: MilestoneUpdateInput
): Promise<MilestoneResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.update');

  const existing = await prisma.milestone.findFirst({
    where: { id, organizationId },
    include: { project: { select: { deletedAt: true } } },
  });
  if (!existing || existing.project?.deletedAt) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (input.status !== undefined && !MILESTONE_STATUSES.includes(input.status)) {
    const error = new Error(`Invalid milestone status: ${input.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const milestone = await prisma.milestone.update({
    where: { id },
    data: {
      name: input.name !== undefined ? input.name.trim() : existing.name,
      dueDate:
        input.dueDate !== undefined
          ? input.dueDate
            ? parseDueDate(input.dueDate)
            : null
          : existing.dueDate,
      status: input.status ?? existing.status,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'milestone.update',
    entityType: 'Milestone',
    entityId: milestone.id,
    before: { id: existing.id, name: existing.name, status: existing.status },
    after: { id: milestone.id, name: milestone.name, status: milestone.status },
    organizationId,
  });

  return milestone;
}

export async function deleteMilestone(id: string): Promise<{ id: string }> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.update');

  const existing = await prisma.milestone.findFirst({
    where: { id, organizationId },
    include: { project: { select: { deletedAt: true } } },
  });
  if (!existing || existing.project?.deletedAt) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  await prisma.milestone.delete({ where: { id } });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'milestone.delete',
    entityType: 'Milestone',
    entityId: id,
    before: { id: existing.id, name: existing.name, projectId: existing.projectId },
    after: null,
    organizationId,
  });

  return { id };
}
