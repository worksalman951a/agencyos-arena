'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  TaskCommentCreateInput,
  TaskCommentUpdateInput,
} from '@/lib/schemas/projects/task-comment.schema';

interface TaskCommentRecord {
  id: string;
  organizationId: string;
  taskId: string;
  userId: string;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string | null; email: string | null };
}

export interface TaskCommentResponse {
  id: string;
  organizationId: string;
  taskId: string;
  userId: string;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
  user?: { id: string; name: string | null; email: string | null };
}

export interface TaskCommentContext {
  task: {
    id: string;
    title: string;
    status: string;
    projectId: string;
    projectName: string;
  };
  currentUserId: string;
  comments: TaskCommentResponse[];
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

async function canModerateComment(
  userId: string,
  organizationId: string,
  commentAuthorId: string
): Promise<boolean> {
  if (commentAuthorId === userId) return true;
  const adminRole = await prisma.userRole.findFirst({
    where: {
      userId,
      organizationId,
      role: { name: 'Administrator', isSystem: true },
    },
  });
  return Boolean(adminRole);
}

export async function listTaskComments(taskId: string): Promise<TaskCommentResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'task.comment.read');

  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId },
  });

  if (!task) {
    const error = new Error('Task not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const comments = (await prisma.taskComment.findMany({
    where: { taskId, organizationId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  })) as TaskCommentRecord[];

  return comments.map((c) => ({
    id: c.id,
    organizationId: c.organizationId,
    taskId: c.taskId,
    userId: c.userId,
    comment: c.comment,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    user: c.user,
  }));
}

export async function getTaskCommentContext(taskId: string): Promise<TaskCommentContext> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'task.comment.read');

  const task = (await prisma.task.findFirst({
    where: { id: taskId, organizationId },
    include: {
      project: { select: { id: true, name: true } },
    },
  })) as {
    id: string;
    title: string;
    status: string;
    projectId: string;
    project: { id: string; name: string };
  } | null;

  if (!task) {
    const error = new Error('Task not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const comments = (await prisma.taskComment.findMany({
    where: { taskId, organizationId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  })) as TaskCommentRecord[];

  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      projectId: task.projectId,
      projectName: task.project.name,
    },
    currentUserId: userId,
    comments: comments.map((c) => ({
      id: c.id,
      organizationId: c.organizationId,
      taskId: c.taskId,
      userId: c.userId,
      comment: c.comment,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      user: c.user,
    })),
  };
}

export async function createTaskComment(
  input: TaskCommentCreateInput
): Promise<TaskCommentResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'task.comment.create');

  const task = await prisma.task.findFirst({
    where: { id: input.taskId, organizationId },
    include: { project: { select: { deletedAt: true } } },
  });

  if (!task || task.project?.deletedAt) {
    const error = new Error('Task not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const comment = await prisma.taskComment.create({
    data: {
      organizationId,
      taskId: input.taskId,
      // Author is always the authenticated caller. `input.userId` is ignored.
      userId,
      comment: input.comment.trim(),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'task.comment.create',
    entityType: 'TaskComment',
    entityId: comment.id,
    after: {
      id: comment.id,
      taskId: comment.taskId,
    },
    organizationId,
  });

  return {
    id: comment.id,
    organizationId: comment.organizationId,
    taskId: comment.taskId,
    userId: comment.userId,
    comment: comment.comment,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    user: comment.user,
  };
}

export async function updateTaskComment(
  id: string,
  input: TaskCommentUpdateInput,
  expectedTaskId?: string
): Promise<TaskCommentResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'task.comment.update');

  const existing = await prisma.taskComment.findFirst({
    where: {
      id,
      organizationId,
      ...(expectedTaskId ? { taskId: expectedTaskId } : {}),
    },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (!(await canModerateComment(userId, organizationId, existing.userId))) {
    const error = new Error('Forbidden') as Error & { statusCode?: number };
    error.statusCode = 403;
    throw error;
  }

  const comment = await prisma.taskComment.update({
    where: { id },
    data: {
      comment: input.comment !== undefined ? input.comment.trim() : existing.comment,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'task.comment.update',
    entityType: 'TaskComment',
    entityId: comment.id,
    before: {
      id: existing.id,
      comment: existing.comment,
    },
    after: {
      id: comment.id,
      comment: comment.comment,
    },
    organizationId,
  });

  return {
    id: comment.id,
    organizationId: comment.organizationId,
    taskId: comment.taskId,
    userId: comment.userId,
    comment: comment.comment,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    user: comment.user,
  };
}

export async function deleteTaskComment(
  id: string,
  expectedTaskId?: string
): Promise<{ id: string }> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'task.comment.delete');

  const existing = await prisma.taskComment.findFirst({
    where: {
      id,
      organizationId,
      ...(expectedTaskId ? { taskId: expectedTaskId } : {}),
    },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (!(await canModerateComment(userId, organizationId, existing.userId))) {
    const error = new Error('Forbidden') as Error & { statusCode?: number };
    error.statusCode = 403;
    throw error;
  }

  await prisma.taskComment.delete({
    where: { id },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'task.comment.delete',
    entityType: 'TaskComment',
    entityId: id,
    before: { id: existing.id, taskId: existing.taskId },
    after: null,
    organizationId,
  });

  return { id };
}
