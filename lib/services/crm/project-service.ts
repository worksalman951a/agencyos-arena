'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectQueryInput,
  ProjectTaskInput,
} from '@/lib/schemas/crm/project.schema';

export interface ProjectResponse {
  id: string;
  organizationId: string;
  clientId: string | null;
  name: string;
  status: string;
  budget: string | null;
  startDate: Date | null;
  endDate: Date | null;
  description: string | null;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  client: { id: string; firstName: string | null; lastName: string } | null;
  tasks: ProjectTaskResponse[];
  milestoneCount: number;
}

export interface ProjectTaskResponse {
  id: string;
  projectId: string;
  assigneeId: string | null;
  milestoneId: string | null;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  estimatedHours: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const PROJECT_STATUSES = ['active', 'on-hold', 'completed', 'archived'];
const TASK_STATUSES = ['todo', 'in-progress', 'review', 'done'];

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    const error = new Error('Unauthenticated') as Error & {
      statusCode?: number;
    };
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
  ipAddress,
  userAgent,
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
  ipAddress?: string | null;
  userAgent?: string | null;
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
      ipAddress,
      userAgent,
      organizationId,
    },
  });
}

function parseDecimal(value: string): number {
  const parsed = Number(value);
  return isNaN(parsed) ? 0 : parsed;
}

function formatMoney(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return parseDecimal(value).toFixed(2);
}

function buildProjectWhere(organizationId: string, input: ProjectQueryInput) {
  const where: Record<string, unknown> = {
    organizationId,
  };

  if (!input.includeDeleted) {
    where.deletedAt = null;
  }

  if (input.clientId) {
    where.clientId = input.clientId;
  }

  if (input.status) {
    where.status = input.status;
  }

  if (input.search) {
    where.OR = [
      { name: { contains: input.search, mode: 'insensitive' } },
      { description: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

type ProjectDbRecord = {
  id: string;
  organizationId: string;
  clientId: string | null;
  name: string;
  status: string;
  budget: { toString: () => string } | null;
  startDate: Date | null;
  endDate: Date | null;
  description: string | null;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  client: { id: string; firstName: string | null; lastName: string } | null;
  tasks: Array<{
    id: string;
    projectId: string;
    assigneeId: string | null;
    milestoneId: string | null;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
    estimatedHours: { toString: () => string } | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  _count: { milestones: number };
};

/**
 * Relations required by serializeProject. Every read/write path that returns a
 * serialized project must fetch these, otherwise the serializer receives
 * undefined relations and the request fails with a 500.
 */
const PROJECT_RESPONSE_INCLUDE = {
  client: { select: { id: true, firstName: true, lastName: true } },
  tasks: { orderBy: { createdAt: 'asc' } },
  _count: { select: { milestones: true } },
} as const;

function serializeProject(project: ProjectDbRecord): ProjectResponse {
  return {
    id: project.id,
    organizationId: project.organizationId,
    clientId: project.clientId,
    name: project.name,
    status: project.status,
    budget: formatMoney(project.budget?.toString()),
    startDate: project.startDate,
    endDate: project.endDate,
    description: project.description,
    deletedAt: project.deletedAt,
    createdBy: project.createdBy,
    updatedBy: project.updatedBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    client: project.client
      ? {
          id: project.client.id,
          firstName: project.client.firstName,
          lastName: project.client.lastName,
        }
      : null,
    tasks: (project.tasks ?? []).map((t) => ({
      id: t.id,
      projectId: t.projectId,
      assigneeId: t.assigneeId,
      milestoneId: t.milestoneId,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      estimatedHours: formatMoney(t.estimatedHours?.toString()),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    milestoneCount: project._count?.milestones ?? 0,
  };
}

export async function listProjects(input: ProjectQueryInput) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.read');

  const where = buildProjectWhere(organizationId, input);
  // Independent read-only statements: run concurrently on separate pooled
  // connections. Deliberately not $transaction(): a transaction pins one pg
  // client, Prisma 7 dispatches relation loads concurrently on it, and pg
  // >= 8.22 deprecates overlapping client.query() (hard error in pg 9).
  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        tasks: { orderBy: { createdAt: 'asc' } },
        _count: { select: { milestones: true } },
      },
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.project.count({ where }),
  ]);

  return {
    projects: projects.map((p: ProjectDbRecord) => serializeProject(p)),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

export async function getProject(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.read');

  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      tasks: { orderBy: { createdAt: 'asc' } },
      _count: { select: { milestones: true } },
    },
  });

  if (!project) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeProject(project as unknown as ProjectDbRecord);
}

export async function createProject(input: ProjectCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.create');

  if (input.clientId) {
    const client = await prisma.contact.findFirst({
      where: { id: input.clientId, organizationId },
    });
    if (!client) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const project = await prisma.project.create({
    data: {
      organizationId,
      clientId: input.clientId ?? null,
      name: input.name,
      status: input.status,
      budget: input.budget ? parseDecimal(input.budget) : null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      description: input.description ?? null,
      createdBy: userId,
      updatedBy: userId,
    },
    include: PROJECT_RESPONSE_INCLUDE,
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'project.create',
    entityType: 'Project',
    entityId: project.id,
    after: {
      id: project.id,
      name: project.name,
      status: project.status,
      clientId: project.clientId,
    },
    organizationId,
  });

  return serializeProject(project as unknown as ProjectDbRecord);
}

export async function updateProject(id: string, input: ProjectUpdateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.update');

  const existing = await prisma.project.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (input.status !== undefined && !PROJECT_STATUSES.includes(input.status)) {
    const error = new Error(`Invalid project status: ${input.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  if (input.clientId !== undefined && input.clientId !== null) {
    const client = await prisma.contact.findFirst({
      where: { id: input.clientId, organizationId },
    });
    if (!client) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      clientId: input.clientId !== undefined ? input.clientId : existing.clientId,
      name: input.name ?? existing.name,
      status: input.status ?? existing.status,
      budget:
        input.budget !== undefined
          ? input.budget
            ? parseDecimal(input.budget)
            : null
          : existing.budget,
      startDate:
        input.startDate !== undefined
          ? input.startDate
            ? new Date(input.startDate)
            : null
          : existing.startDate,
      endDate:
        input.endDate !== undefined
          ? input.endDate
            ? new Date(input.endDate)
            : null
          : existing.endDate,
      description: input.description ?? existing.description,
      updatedBy: userId,
    },
    include: PROJECT_RESPONSE_INCLUDE,
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'project.update',
    entityType: 'Project',
    entityId: project.id,
    before: { id: existing.id, name: existing.name, status: existing.status },
    after: { id: project.id, name: project.name, status: project.status },
    organizationId,
  });

  return serializeProject(project as unknown as ProjectDbRecord);
}

export async function addProjectTask(projectId: string, input: ProjectTaskInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.update');

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
  });

  if (!project) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (input.status !== undefined && !TASK_STATUSES.includes(input.status)) {
    const error = new Error(`Invalid task status: ${input.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const task = await prisma.task.create({
    data: {
      organizationId,
      projectId,
      assigneeId: input.assigneeId ?? null,
      milestoneId: input.milestoneId ?? null,
      title: input.title,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      estimatedHours: input.estimatedHours ? parseDecimal(input.estimatedHours) : null,
      // The Task model has no createdBy/updatedBy columns; authorship is
      // recorded in the audit log entry below.
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'task.create',
    entityType: 'Task',
    entityId: task.id,
    after: { id: task.id, title: task.title, status: task.status, projectId },
    organizationId,
  });

  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
  };
}

export async function deleteProject(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.delete');

  const existing = await prisma.project.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'project.delete',
    entityType: 'Project',
    entityId: project.id,
    before: { id: existing.id, name: existing.name },
    after: null,
    organizationId,
  });

  return { id: project.id, deletedAt: project.deletedAt };
}
