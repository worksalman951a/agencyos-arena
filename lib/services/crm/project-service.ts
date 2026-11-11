'use server';

import { prisma } from '@/lib/db';
import {
  emitWorkflowEvent,
  emitWorkflowEvents,
} from '@/lib/services/automation/run-workflow-service';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  PROJECT_STATUS_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectQueryInput,
  ProjectTaskInput,
  ProjectTaskUpdateInput,
} from '@/lib/schemas/crm/project.schema';

export interface ProjectResponse {
  id: string;
  organizationId: string;
  clientId: string | null;
  templateId: string | null;
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
  client: {
    id: string;
    firstName: string | null;
    lastName: string;
    account?: { id: string; name: string } | null;
  } | null;
  template: { id: string; name: string } | null;
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
  assignee?: { id: string; name: string | null; email: string | null } | null;
  milestone?: { id: string; name: string; status: string } | null;
}

export interface ProjectMemberSummary {
  id: string;
  name: string | null;
  email: string;
}

export interface ProjectMilestoneSummary {
  id: string;
  projectId: string;
  name: string;
  dueDate: Date | null;
  status: string;
  totalTasks: number;
  completedTasks: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectWorkspaceDetails {
  milestones: ProjectMilestoneSummary[];
  timeSummary: {
    entryCount: number;
    totalHours: number;
    billableHours: number;
    nonBillableHours: number;
  };
  counts: {
    files: number;
    approvals: number;
    changeOrders: number;
  };
  activity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    actorName: string | null;
    createdAt: Date;
  }>;
}

const PROJECT_STATUSES: readonly string[] = PROJECT_STATUS_VALUES;
const TASK_STATUSES: readonly string[] = TASK_STATUS_VALUES;
const TASK_PRIORITIES: readonly string[] = TASK_PRIORITY_VALUES;

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

function badRequest(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

function notFound(message = 'Not found'): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 404;
  return error;
}

function parseNonNegativeDecimal(value: string, fieldName: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (!trimmed || Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < 0) {
    throw badRequest(`Invalid ${fieldName}`);
  }
  return parsed;
}

function parseValidDate(value: string, fieldName: string): Date {
  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (!trimmed || Number.isNaN(parsed.getTime())) {
    throw badRequest(`Invalid ${fieldName}`);
  }
  return parsed;
}

function formatMoney(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return parsed.toFixed(2);
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

  if (input.accountId) {
    where.client = { accountId: input.accountId };
  }

  if (input.status) {
    where.status = input.status;
  }

  if (input.search) {
    where.OR = [
      { name: { contains: input.search, mode: 'insensitive' } },
      { description: { contains: input.search, mode: 'insensitive' } },
      { client: { firstName: { contains: input.search, mode: 'insensitive' } } },
      { client: { lastName: { contains: input.search, mode: 'insensitive' } } },
      { client: { account: { name: { contains: input.search, mode: 'insensitive' } } } },
    ];
  }

  return where;
}

type ProjectDbRecord = {
  id: string;
  organizationId: string;
  clientId: string | null;
  templateId?: string | null;
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
  client: {
    id: string;
    firstName: string | null;
    lastName: string;
    account?: { id: string; name: string } | null;
  } | null;
  template?: { id: string; name: string } | null;
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
    assignee?: { id: string; name: string | null; email: string | null } | null;
    milestone?: { id: string; name: string; status: string } | null;
  }>;
  _count: { milestones: number };
};

/**
 * Relations required by serializeProject. Every read/write path that returns a
 * serialized project must fetch these, otherwise the serializer receives
 * undefined relations and the request fails with a 500.
 */
const PROJECT_RESPONSE_INCLUDE = {
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      account: { select: { id: true, name: true } },
    },
  },
  template: { select: { id: true, name: true } },
  tasks: {
    orderBy: { createdAt: 'asc' },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      milestone: { select: { id: true, name: true, status: true } },
    },
  },
  _count: { select: { milestones: true } },
} as const;

function serializeTask(t: ProjectDbRecord['tasks'][number]): ProjectTaskResponse {
  return {
    id: t.id,
    projectId: t.projectId,
    assigneeId: t.assigneeId ?? null,
    milestoneId: t.milestoneId ?? null,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    estimatedHours: formatMoney(t.estimatedHours?.toString()),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    assignee: t.assignee ?? null,
    milestone: t.milestone ?? null,
  };
}

function serializeProject(project: ProjectDbRecord): ProjectResponse {
  return {
    id: project.id,
    organizationId: project.organizationId,
    clientId: project.clientId,
    templateId: project.templateId ?? null,
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
          account: project.client.account ?? null,
        }
      : null,
    template: project.template ?? null,
    tasks: (project.tasks ?? []).map(serializeTask),
    milestoneCount: project._count?.milestones ?? 0,
  };
}

export async function listProjects(input: ProjectQueryInput): Promise<{
  projects: ProjectResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
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
      include: PROJECT_RESPONSE_INCLUDE,
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.project.count({ where }),
  ]);

  return {
    projects: (projects as ProjectDbRecord[]).map((p) => serializeProject(p)),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

export async function getProject(id: string): Promise<ProjectResponse> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.read');

  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    include: PROJECT_RESPONSE_INCLUDE,
  });

  if (!project) {
    throw notFound();
  }

  return serializeProject(project as unknown as ProjectDbRecord);
}

export async function createProject(input: ProjectCreateInput): Promise<ProjectResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.create');

  if (!PROJECT_STATUSES.includes(input.status)) {
    throw badRequest(`Invalid project status: ${input.status}`);
  }

  if (input.clientId) {
    const client = await prisma.contact.findFirst({
      where: { id: input.clientId, organizationId, deletedAt: null },
    });
    if (!client) {
      throw notFound();
    }
  }

  if (input.templateId) {
    const template = await prisma.projectTemplate.findFirst({
      where: { id: input.templateId, organizationId },
    });
    if (!template) {
      throw notFound('Project template not found');
    }
  }

  const parsedBudget = input.budget ? parseNonNegativeDecimal(input.budget, 'budget') : null;
  const parsedStartDate = input.startDate ? parseValidDate(input.startDate, 'startDate') : null;
  const parsedEndDate = input.endDate ? parseValidDate(input.endDate, 'endDate') : null;

  if (parsedStartDate && parsedEndDate && parsedEndDate.getTime() < parsedStartDate.getTime()) {
    throw badRequest('End date must be on or after start date');
  }

  const project = await prisma.project.create({
    data: {
      organizationId,
      clientId: input.clientId ?? null,
      templateId: input.templateId ?? null,
      name: input.name.trim(),
      status: input.status,
      budget: parsedBudget,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
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
      templateId: project.templateId,
    },
    organizationId,
  });

  await emitWorkflowEvent({ type: 'record.created', recordType: 'Project', recordId: project.id });

  return serializeProject(project as unknown as ProjectDbRecord);
}

export async function updateProject(
  id: string,
  input: ProjectUpdateInput
): Promise<ProjectResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.update');

  const existing = await prisma.project.findFirst({
    where: { id, organizationId },
  });

  if (!existing || existing.deletedAt) {
    throw notFound();
  }

  if (input.status !== undefined && !PROJECT_STATUSES.includes(input.status)) {
    throw badRequest(`Invalid project status: ${input.status}`);
  }

  if (input.clientId !== undefined && input.clientId !== null) {
    const client = await prisma.contact.findFirst({
      where: { id: input.clientId, organizationId, deletedAt: null },
    });
    if (!client) {
      throw notFound();
    }
  }

  if (input.templateId !== undefined && input.templateId !== null) {
    const template = await prisma.projectTemplate.findFirst({
      where: { id: input.templateId, organizationId },
    });
    if (!template) {
      throw notFound('Project template not found');
    }
  }

  const nextBudget =
    input.budget !== undefined
      ? input.budget
        ? parseNonNegativeDecimal(input.budget, 'budget')
        : null
      : existing.budget;

  const nextStartDate =
    input.startDate !== undefined
      ? input.startDate
        ? parseValidDate(input.startDate, 'startDate')
        : null
      : existing.startDate;

  const nextEndDate =
    input.endDate !== undefined
      ? input.endDate
        ? parseValidDate(input.endDate, 'endDate')
        : null
      : existing.endDate;

  if (nextStartDate && nextEndDate && nextEndDate.getTime() < nextStartDate.getTime()) {
    throw badRequest('End date must be on or after start date');
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      clientId: input.clientId !== undefined ? input.clientId : existing.clientId,
      templateId: input.templateId !== undefined ? input.templateId : existing.templateId,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      status: input.status ?? existing.status,
      budget: nextBudget,
      startDate: nextStartDate,
      endDate: nextEndDate,
      description: input.description !== undefined ? input.description : existing.description,
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

  await emitWorkflowEvents([
    { type: 'record.updated', recordType: 'Project', recordId: project.id },
    ...(existing.status !== project.status
      ? [
          {
            type: 'record.status_changed',
            recordType: 'Project',
            recordId: project.id,
            previousStatus: existing.status,
          },
        ]
      : []),
  ]);

  return serializeProject(project as unknown as ProjectDbRecord);
}

export async function addProjectTask(
  projectId: string,
  input: ProjectTaskInput
): Promise<ProjectTaskResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.update');

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
  });

  if (!project || project.deletedAt) {
    throw notFound();
  }

  if (input.status !== undefined && !TASK_STATUSES.includes(input.status)) {
    throw badRequest(`Invalid task status: ${input.status}`);
  }

  if (input.priority !== undefined && !TASK_PRIORITIES.includes(input.priority)) {
    throw badRequest(`Invalid task priority: ${input.priority}`);
  }

  if (input.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: input.assigneeId, organizationId },
    });
    if (!assignee) {
      throw notFound('Assignee not found');
    }
  }

  if (input.milestoneId) {
    const milestone = await prisma.milestone.findFirst({
      where: { id: input.milestoneId, projectId, organizationId },
    });
    if (!milestone) {
      throw notFound('Milestone not found');
    }
  }

  const parsedDueDate = input.dueDate ? parseValidDate(input.dueDate, 'dueDate') : null;
  const parsedEstimatedHours = input.estimatedHours
    ? parseNonNegativeDecimal(input.estimatedHours, 'estimatedHours')
    : null;

  const task = await prisma.task.create({
    data: {
      organizationId,
      projectId,
      assigneeId: input.assigneeId ?? null,
      milestoneId: input.milestoneId ?? null,
      title: input.title.trim(),
      status: input.status,
      priority: input.priority,
      dueDate: parsedDueDate,
      estimatedHours: parsedEstimatedHours,
      // The Task model has no createdBy/updatedBy columns; authorship is
      // recorded in the audit log entry below.
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      milestone: { select: { id: true, name: true, status: true } },
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

  await emitWorkflowEvent({ type: 'record.created', recordType: 'Task', recordId: task.id });

  return serializeTask(task as unknown as ProjectDbRecord['tasks'][number]);
}

export async function getProjectTask(
  taskId: string
): Promise<ProjectTaskResponse & { project: { id: string; name: string } }> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.read');

  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      milestone: { select: { id: true, name: true, status: true } },
      project: { select: { id: true, name: true } },
    },
  });

  if (!task) {
    throw notFound('Task not found');
  }

  return {
    ...serializeTask(task as unknown as ProjectDbRecord['tasks'][number]),
    project: (task as { project: { id: string; name: string } }).project,
  };
}

export async function updateProjectTask(
  taskId: string,
  input: ProjectTaskUpdateInput,
  expectedProjectId?: string
): Promise<ProjectTaskResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.update');

  const existing = await prisma.task.findFirst({
    where: {
      id: taskId,
      organizationId,
      ...(expectedProjectId ? { projectId: expectedProjectId } : {}),
    },
    include: {
      project: { select: { id: true, deletedAt: true } },
    },
  });

  if (!existing || existing.project?.deletedAt) {
    throw notFound('Task not found');
  }

  if (input.status !== undefined && !TASK_STATUSES.includes(input.status)) {
    throw badRequest(`Invalid task status: ${input.status}`);
  }

  if (input.priority !== undefined && !TASK_PRIORITIES.includes(input.priority)) {
    throw badRequest(`Invalid task priority: ${input.priority}`);
  }

  if (input.assigneeId !== undefined && input.assigneeId !== null) {
    const assignee = await prisma.user.findFirst({
      where: { id: input.assigneeId, organizationId },
    });
    if (!assignee) {
      throw notFound('Assignee not found');
    }
  }

  if (input.milestoneId !== undefined && input.milestoneId !== null) {
    const milestone = await prisma.milestone.findFirst({
      where: { id: input.milestoneId, projectId: existing.projectId, organizationId },
    });
    if (!milestone) {
      throw notFound('Milestone not found');
    }
  }

  const nextDueDate =
    input.dueDate !== undefined
      ? input.dueDate
        ? parseValidDate(input.dueDate, 'dueDate')
        : null
      : existing.dueDate;

  const nextEstimatedHours =
    input.estimatedHours !== undefined
      ? input.estimatedHours
        ? parseNonNegativeDecimal(input.estimatedHours, 'estimatedHours')
        : null
      : existing.estimatedHours;

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: input.title !== undefined ? input.title.trim() : existing.title,
      status: input.status ?? existing.status,
      priority: input.priority ?? existing.priority,
      assigneeId: input.assigneeId !== undefined ? input.assigneeId : existing.assigneeId,
      milestoneId: input.milestoneId !== undefined ? input.milestoneId : existing.milestoneId,
      dueDate: nextDueDate,
      estimatedHours: nextEstimatedHours,
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      milestone: { select: { id: true, name: true, status: true } },
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'task.update',
    entityType: 'Task',
    entityId: task.id,
    before: {
      id: existing.id,
      title: existing.title,
      status: existing.status,
      assigneeId: existing.assigneeId,
      milestoneId: existing.milestoneId,
    },
    after: {
      id: task.id,
      title: task.title,
      status: task.status,
      assigneeId: task.assigneeId,
      milestoneId: task.milestoneId,
    },
    organizationId,
  });

  await emitWorkflowEvents([
    { type: 'record.updated', recordType: 'Task', recordId: task.id },
    ...(existing.status !== task.status
      ? [
          {
            type: 'record.status_changed',
            recordType: 'Task',
            recordId: task.id,
            previousStatus: existing.status,
          },
        ]
      : []),
  ]);

  return serializeTask(task as unknown as ProjectDbRecord['tasks'][number]);
}

export async function deleteProjectTask(
  taskId: string,
  expectedProjectId?: string
): Promise<{ id: string }> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.update');

  const existing = await prisma.task.findFirst({
    where: {
      id: taskId,
      organizationId,
      ...(expectedProjectId ? { projectId: expectedProjectId } : {}),
    },
    include: {
      project: { select: { id: true, deletedAt: true } },
    },
  });

  if (!existing || existing.project?.deletedAt) {
    throw notFound('Task not found');
  }

  await prisma.task.delete({ where: { id: taskId } });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'task.delete',
    entityType: 'Task',
    entityId: taskId,
    before: { id: existing.id, title: existing.title, projectId: existing.projectId },
    after: null,
    organizationId,
  });

  return { id: taskId };
}

export async function listProjectMembers(): Promise<ProjectMemberSummary[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  const candidatePermissions = [
    'project.read',
    'time.entry.read',
    'change.order.read',
    'project.approval.read',
  ];
  let authorized = false;
  let lastError: unknown;
  for (const code of candidatePermissions) {
    try {
      await requirePermission(userId, organizationId, code);
      authorized = true;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!authorized) {
    throw lastError ?? badRequest('Forbidden');
  }

  const users = await prisma.user.findMany({
    where: { organizationId, status: 'active' },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
  });

  return users;
}

export async function getProjectWorkspaceDetails(
  projectId: string
): Promise<ProjectWorkspaceDetails> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.read');

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true },
  });

  if (!project) {
    throw notFound();
  }

  const [milestones, tasks, timeEntries, filesCount, approvalsCount, changeOrdersCount, childIds] =
    await Promise.all([
      prisma.milestone.findMany({
        where: { projectId, organizationId },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.task.findMany({
        where: { projectId, organizationId },
        select: { id: true, milestoneId: true, status: true },
      }),
      prisma.timeEntry.findMany({
        where: { organizationId, task: { projectId } },
        select: { id: true, hours: true, billable: true },
      }),
      prisma.projectFile.count({ where: { projectId, organizationId } }),
      prisma.projectApproval.count({ where: { projectId, organizationId } }),
      prisma.changeOrder.count({ where: { projectId, organizationId } }),
      Promise.all([
        prisma.projectApproval.findMany({
          where: { projectId, organizationId },
          select: { id: true },
        }),
        prisma.changeOrder.findMany({
          where: { projectId, organizationId },
          select: { id: true },
        }),
        prisma.projectFile.findMany({
          where: { projectId, organizationId },
          select: { id: true },
        }),
      ]),
    ]);

  const milestoneSummaries: ProjectMilestoneSummary[] = milestones.map(
    (m: {
      id: string;
      projectId: string;
      name: string;
      dueDate: Date | null;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }) => {
      const linked = tasks.filter((t: { milestoneId: string | null }) => t.milestoneId === m.id);
      return {
        id: m.id,
        projectId: m.projectId,
        name: m.name,
        dueDate: m.dueDate,
        status: m.status,
        totalTasks: linked.length,
        completedTasks: linked.filter((t: { status: string }) => t.status === 'done').length,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    }
  );

  let totalHours = 0;
  let billableHours = 0;
  for (const entry of timeEntries as Array<{
    hours: { toString: () => string };
    billable: boolean;
  }>) {
    const hrs = Number(entry.hours.toString());
    if (!Number.isNaN(hrs)) {
      totalHours += hrs;
      if (entry.billable) billableHours += hrs;
    }
  }

  const taskIds = tasks.map((t: { id: string }) => t.id);
  const milestoneIds = milestones.map((m: { id: string }) => m.id);
  const [approvalIds, changeOrderIds, fileIds] = childIds.map((rows) =>
    rows.map((r: { id: string }) => r.id)
  );
  const timeEntryIds = timeEntries.map((te: { id: string }) => te.id);

  const orFilters: Array<Record<string, unknown>> = [
    { entityType: 'Project', entityId: projectId },
  ];
  if (taskIds.length > 0) {
    orFilters.push({ entityType: 'Task', entityId: { in: taskIds } });
  }
  if (milestoneIds.length > 0) {
    orFilters.push({ entityType: 'Milestone', entityId: { in: milestoneIds } });
  }
  if (approvalIds.length > 0) {
    orFilters.push({ entityType: 'ProjectApproval', entityId: { in: approvalIds } });
  }
  if (changeOrderIds.length > 0) {
    orFilters.push({ entityType: 'ChangeOrder', entityId: { in: changeOrderIds } });
  }
  if (fileIds.length > 0) {
    orFilters.push({ entityType: 'ProjectFile', entityId: { in: fileIds } });
  }
  if (timeEntryIds.length > 0) {
    orFilters.push({ entityType: 'TimeEntry', entityId: { in: timeEntryIds } });
  }

  const activity = await prisma.auditLog.findMany({
    where: {
      organizationId,
      OR: orFilters,
    },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorName: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return {
    milestones: milestoneSummaries,
    timeSummary: {
      entryCount: timeEntries.length,
      totalHours: Number(totalHours.toFixed(2)),
      billableHours: Number(billableHours.toFixed(2)),
      nonBillableHours: Number((totalHours - billableHours).toFixed(2)),
    },
    counts: {
      files: filesCount,
      approvals: approvalsCount,
      changeOrders: changeOrdersCount,
    },
    activity,
  };
}

export async function deleteProject(id: string): Promise<{ id: string; deletedAt: Date | null }> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.delete');

  const existing = await prisma.project.findFirst({
    where: { id, organizationId },
  });

  if (!existing || existing.deletedAt) {
    throw notFound();
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
