'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  TimeEntryCreateInput,
  TimeEntryUpdateInput,
} from '@/lib/schemas/projects/time-entry.schema';

interface TimeEntryRecord {
  id: string;
  organizationId: string;
  userId: string;
  taskId: string | null;
  date: Date;
  hours: { toString: () => string };
  description: string | null;
  billable: boolean;
  createdAt: Date;
  user: { id: string; name: string | null; email: string | null } | null;
  task: {
    id: string;
    title: string;
    projectId: string;
    project?: { id: string; name: string } | null;
  } | null;
}

export interface TimeEntryResponse {
  id: string;
  organizationId: string;
  userId: string;
  taskId: string | null;
  date: Date;
  hours: string;
  description: string | null;
  billable: boolean;
  createdAt: Date;
  user?: { id: string; name: string | null; email: string | null } | null;
  task?: {
    id: string;
    title: string;
    projectId: string;
    project?: { id: string; name: string } | null;
  } | null;
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

function parseHours(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (
    !trimmed ||
    Number.isNaN(parsed) ||
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed > 1000
  ) {
    const error = new Error('Hours must be a positive number up to 1000') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function parseEntryDate(value: string): Date {
  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (!trimmed || Number.isNaN(parsed.getTime())) {
    const error = new Error('Valid date is required') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function serializeTimeEntry(te: TimeEntryRecord): TimeEntryResponse {
  return {
    id: te.id,
    organizationId: te.organizationId,
    userId: te.userId,
    taskId: te.taskId,
    date: te.date,
    hours: te.hours.toString(),
    description: te.description,
    billable: te.billable,
    createdAt: te.createdAt,
    user: te.user ?? null,
    task: te.task ?? null,
  };
}

const TIME_ENTRY_INCLUDE = {
  user: { select: { id: true, name: true, email: true } },
  task: {
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { id: true, name: true } },
    },
  },
} as const;

export async function listTimeEntries(
  taskId?: string,
  projectId?: string,
  billable?: boolean
): Promise<TimeEntryResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.read');

  const where: Record<string, unknown> = { organizationId };

  if (taskId) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) {
      const error = new Error('Task not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
    where.taskId = taskId;
  }

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      const error = new Error('Project not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
    where.task = { projectId };
  }

  if (billable !== undefined) {
    where.billable = billable;
  }

  const timeEntries = (await prisma.timeEntry.findMany({
    where,
    include: TIME_ENTRY_INCLUDE,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })) as TimeEntryRecord[];

  return timeEntries.map(serializeTimeEntry);
}

export async function getTimeEntry(id: string): Promise<TimeEntryResponse> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.read');

  const timeEntry = (await prisma.timeEntry.findFirst({
    where: { id, organizationId },
    include: TIME_ENTRY_INCLUDE,
  })) as TimeEntryRecord | null;

  if (!timeEntry) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeTimeEntry(timeEntry);
}

export async function createTimeEntry(input: TimeEntryCreateInput): Promise<TimeEntryResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.create');

  const targetUserId = input.userId ?? userId;
  if (targetUserId !== userId) {
    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, organizationId },
    });
    if (!targetUser) {
      const error = new Error('User not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, organizationId },
      include: { project: { select: { deletedAt: true } } },
    });
    if (!task || task.project?.deletedAt) {
      const error = new Error('Task not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const parsedDate = parseEntryDate(input.date);
  const parsedHours = parseHours(input.hours);

  const timeEntry = (await prisma.timeEntry.create({
    data: {
      organizationId,
      userId: targetUserId,
      taskId: input.taskId ?? null,
      date: parsedDate,
      hours: parsedHours,
      description: input.description ?? null,
      billable: input.billable,
    },
    include: TIME_ENTRY_INCLUDE,
  })) as TimeEntryRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'time.entry.create',
    entityType: 'TimeEntry',
    entityId: timeEntry.id,
    after: {
      id: timeEntry.id,
      taskId: timeEntry.taskId,
      hours: timeEntry.hours.toString(),
      billable: timeEntry.billable,
    },
    organizationId,
  });

  return serializeTimeEntry(timeEntry);
}

export async function updateTimeEntry(
  id: string,
  input: TimeEntryUpdateInput
): Promise<TimeEntryResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.update');

  const existing = await prisma.timeEntry.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (input.userId !== undefined && input.userId !== null) {
    const targetUser = await prisma.user.findFirst({
      where: { id: input.userId, organizationId },
    });
    if (!targetUser) {
      const error = new Error('User not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  if (input.taskId !== undefined && input.taskId !== null) {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, organizationId },
      include: { project: { select: { deletedAt: true } } },
    });
    if (!task || task.project?.deletedAt) {
      const error = new Error('Task not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const nextDate = input.date ? parseEntryDate(input.date) : existing.date;
  const nextHours = input.hours !== undefined ? parseHours(input.hours) : existing.hours;

  const timeEntry = (await prisma.timeEntry.update({
    where: { id },
    data: {
      userId: input.userId !== undefined && input.userId !== null ? input.userId : existing.userId,
      taskId: input.taskId !== undefined ? input.taskId : existing.taskId,
      date: nextDate,
      hours: nextHours,
      description: input.description !== undefined ? input.description : existing.description,
      billable: input.billable !== undefined ? input.billable : existing.billable,
    },
    include: TIME_ENTRY_INCLUDE,
  })) as TimeEntryRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'time.entry.update',
    entityType: 'TimeEntry',
    entityId: timeEntry.id,
    before: {
      id: existing.id,
      hours: existing.hours.toString(),
    },
    after: {
      id: timeEntry.id,
      hours: timeEntry.hours.toString(),
    },
    organizationId,
  });

  return serializeTimeEntry(timeEntry);
}

export async function deleteTimeEntry(id: string): Promise<{ id: string }> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.delete');

  const existing = await prisma.timeEntry.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  await prisma.timeEntry.delete({
    where: { id },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'time.entry.delete',
    entityType: 'TimeEntry',
    entityId: id,
    before: { id: existing.id, hours: existing.hours.toString(), taskId: existing.taskId },
    after: null,
    organizationId,
  });

  return { id };
}
