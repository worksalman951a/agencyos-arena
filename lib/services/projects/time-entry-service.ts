'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from '@/lib/currencies';
import { normalizeOrganizationSettings } from '@/lib/schemas/settings/organization.schema';
import {
  computeBillableAmountText,
  isValidHourlyRateText,
  isValidHoursText,
  normalizeHourlyRateText,
  summarizeTimeEntries,
  type TimeEntrySummary,
} from '@/lib/projects/time-entry-billing';
import {
  TimeEntryCreateInput,
  TimeEntryUpdateInput,
} from '@/lib/schemas/projects/time-entry.schema';

interface ProjectRefRecord {
  id: string;
  name: string;
  status?: string;
  deletedAt?: Date | null;
}

interface TimeEntryRecord {
  id: string;
  organizationId: string;
  userId: string;
  projectId?: string | null;
  taskId: string | null;
  date: Date;
  hours: { toString: () => string };
  description: string | null;
  billable: boolean;
  hourlyRate?: { toString: () => string } | null;
  currency?: string | null;
  createdAt: Date;
  updatedAt?: Date;
  user: { id: string; name: string | null; email: string | null } | null;
  project?: ProjectRefRecord | null;
  task: {
    id: string;
    title: string;
    projectId: string;
    project?: ProjectRefRecord | null;
  } | null;
}

export interface TimeEntryResponse {
  id: string;
  organizationId: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  date: Date;
  hours: string;
  description: string | null;
  billable: boolean;
  hourlyRate: string | null;
  currency: string | null;
  billableAmount: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: { id: string; name: string | null; email: string | null } | null;
  project?: { id: string; name: string; status: string; deleted: boolean } | null;
  task?: {
    id: string;
    title: string;
    projectId: string;
    project?: { id: string; name: string } | null;
  } | null;
}

export interface TimeEntryFilterOptions {
  userId?: string;
  from?: string;
  to?: string;
}

export interface TimeEntriesAccessContext {
  currentUserId: string;
  isAdmin: boolean;
  defaultCurrency: string;
}

function codedError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    throw codedError('Unauthenticated', 401);
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

async function isOrganizationAdmin(userId: string, organizationId: string): Promise<boolean> {
  const adminRole = await prisma.userRole?.findFirst?.({
    where: {
      userId,
      organizationId,
      role: { name: 'Administrator', isSystem: true },
    },
  });
  return Boolean(adminRole);
}

async function resolveOrganizationDefaultCurrency(organizationId: string): Promise<string> {
  try {
    const organization = await prisma.organization?.findUnique?.({
      where: { id: organizationId },
      select: { settings: true },
    });
    const settings = normalizeOrganizationSettings(organization?.settings);
    return normalizeCurrencyCode(settings.defaultCurrency) ?? DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
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
  if (!isValidHoursText(trimmed)) {
    throw codedError('Hours must be a positive number up to 1000', 400);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) {
    throw codedError('Hours must be a positive number up to 1000', 400);
  }
  return parsed;
}

function parseHourlyRate(value: string): string {
  const trimmed = value.trim();
  if (!isValidHourlyRateText(trimmed)) {
    throw codedError('Hourly rate must be a positive number up to 1,000,000', 400);
  }
  return normalizeHourlyRateText(trimmed);
}

function parseCurrency(value: string): string {
  const normalized = normalizeCurrencyCode(value);
  if (!normalized) {
    throw codedError('Unsupported ISO 4217 currency code', 400);
  }
  return normalized;
}

function parseEntryDate(value: string): Date {
  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (!trimmed || Number.isNaN(parsed.getTime())) {
    throw codedError('Valid date is required', 400);
  }
  return parsed;
}

function parseDateBound(
  value: string | undefined,
  label: string,
  endOfDay = false
): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (Number.isNaN(date.getTime())) {
    throw codedError(`Invalid ${label} date filter`, 400);
  }
  if (endOfDay && trimmed.length === 10) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function serializeTimeEntry(te: TimeEntryRecord): TimeEntryResponse {
  const effectiveProjectId = te.projectId ?? te.task?.projectId ?? null;
  const rawProject = te.project ?? te.task?.project ?? null;
  const rawRate =
    te.hourlyRate !== null && te.hourlyRate !== undefined
      ? normalizeHourlyRateText(te.hourlyRate.toString())
      : null;
  const currency = te.currency ?? null;

  return {
    id: te.id,
    organizationId: te.organizationId,
    userId: te.userId,
    projectId: effectiveProjectId,
    taskId: te.taskId,
    date: te.date,
    hours: te.hours.toString(),
    description: te.description,
    billable: te.billable,
    hourlyRate: rawRate,
    currency,
    billableAmount: computeBillableAmountText(te.hours, rawRate, te.billable),
    createdAt: te.createdAt,
    updatedAt: te.updatedAt ?? te.createdAt,
    user: te.user ?? null,
    project: rawProject
      ? {
          id: rawProject.id,
          name: rawProject.name,
          status: rawProject.status ?? 'active',
          deleted: Boolean(rawProject.deletedAt),
        }
      : null,
    task: te.task
      ? {
          id: te.task.id,
          title: te.task.title,
          projectId: te.task.projectId,
          project: te.task.project ? { id: te.task.project.id, name: te.task.project.name } : null,
        }
      : null,
  };
}

const TIME_ENTRY_INCLUDE = {
  user: { select: { id: true, name: true, email: true } },
  project: { select: { id: true, name: true, status: true, deletedAt: true } },
  task: {
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { id: true, name: true, status: true, deletedAt: true } },
    },
  },
} as const;

async function buildTimeEntryWhere(
  organizationId: string,
  taskId?: string,
  projectId?: string,
  billable?: boolean,
  options?: TimeEntryFilterOptions
): Promise<Record<string, unknown>> {
  const where: Record<string, unknown> = { organizationId };

  if (taskId) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) {
      throw codedError('Task not found', 404);
    }
    where.taskId = taskId;
  }

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      throw codedError('Project not found', 404);
    }
    where.OR = [{ projectId }, { task: { projectId } }];
  }

  if (options?.userId) {
    const member = await prisma.user.findFirst({
      where: { id: options.userId, organizationId },
    });
    if (!member) {
      throw codedError('User not found', 404);
    }
    where.userId = options.userId;
  }

  if (billable !== undefined) {
    where.billable = billable;
  }

  const fromDate = parseDateBound(options?.from, 'from', false);
  const toDate = parseDateBound(options?.to, 'to', true);
  if (fromDate && toDate && fromDate > toDate) {
    throw codedError('The from date filter cannot be after the to date filter', 400);
  }
  if (fromDate || toDate) {
    where.date = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  return where;
}

export async function getTimeEntryFormContext(): Promise<TimeEntriesAccessContext> {
  const { userId, organizationId } = await getAuthorizedUser();
  const [isAdmin, defaultCurrency] = await Promise.all([
    isOrganizationAdmin(userId, organizationId),
    resolveOrganizationDefaultCurrency(organizationId),
  ]);

  return {
    currentUserId: userId,
    isAdmin,
    defaultCurrency,
  };
}

export async function getTimeEntriesAccessContext(): Promise<TimeEntriesAccessContext> {
  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'time.entry.read');

  const [isAdmin, defaultCurrency] = await Promise.all([
    isOrganizationAdmin(userId, organizationId),
    resolveOrganizationDefaultCurrency(organizationId),
  ]);

  return {
    currentUserId: userId,
    isAdmin,
    defaultCurrency,
  };
}

export async function listTimeEntries(
  taskId?: string,
  projectId?: string,
  billable?: boolean,
  options?: TimeEntryFilterOptions
): Promise<TimeEntryResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.read');

  const where = await buildTimeEntryWhere(organizationId, taskId, projectId, billable, options);

  const timeEntries = (await prisma.timeEntry.findMany({
    where,
    include: TIME_ENTRY_INCLUDE,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })) as TimeEntryRecord[];

  return timeEntries.map(serializeTimeEntry);
}

export async function getTimeEntrySummary(
  taskId?: string,
  projectId?: string,
  billable?: boolean,
  options?: TimeEntryFilterOptions
): Promise<TimeEntrySummary> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.read');

  const where = await buildTimeEntryWhere(organizationId, taskId, projectId, billable, options);

  const timeEntries = (await prisma.timeEntry.findMany({
    where,
    select: { hours: true, billable: true, hourlyRate: true, currency: true },
  })) as Array<{
    hours: { toString: () => string };
    billable: boolean;
    hourlyRate: { toString: () => string } | null;
    currency: string | null;
  }>;

  return summarizeTimeEntries(timeEntries);
}

export async function getTimeEntry(id: string): Promise<TimeEntryResponse> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.read');

  const timeEntry = (await prisma.timeEntry.findFirst({
    where: { id, organizationId },
    include: TIME_ENTRY_INCLUDE,
  })) as TimeEntryRecord | null;

  if (!timeEntry) {
    throw codedError('Not found', 404);
  }

  return serializeTimeEntry(timeEntry);
}

export async function createTimeEntry(input: TimeEntryCreateInput): Promise<TimeEntryResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.create');

  const targetUserId = input.userId ?? userId;
  if (targetUserId !== userId) {
    const isAdmin = await isOrganizationAdmin(userId, organizationId);
    if (!isAdmin) {
      throw codedError('Forbidden: only administrators can log time for another user', 403);
    }
    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, organizationId },
    });
    if (!targetUser) {
      throw codedError('User not found', 404);
    }
  }

  const inputProjectId = input.projectId ?? null;
  const inputTaskId = input.taskId ?? null;
  let resolvedProjectId: string | null = inputProjectId;

  if (inputTaskId) {
    const task = await prisma.task.findFirst({
      where: { id: inputTaskId, organizationId },
      include: { project: { select: { id: true, status: true, deletedAt: true } } },
    });
    if (!task || !task.project || task.project.deletedAt) {
      throw codedError('Task not found', 404);
    }
    if (task.project.status === 'archived') {
      throw codedError('Cannot log time against an archived project', 400);
    }
    const taskProjectId = task.projectId ?? task.project.id ?? null;
    if (inputProjectId && taskProjectId && inputProjectId !== taskProjectId) {
      throw codedError('Task does not belong to the specified project', 400);
    }
    resolvedProjectId = taskProjectId ?? inputProjectId;
  } else if (inputProjectId) {
    const project = await prisma.project.findFirst({
      where: { id: inputProjectId, organizationId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!project) {
      throw codedError('Project not found', 404);
    }
    if (project.status === 'archived') {
      throw codedError('Cannot log time against an archived project', 400);
    }
    resolvedProjectId = project.id;
  }

  const parsedDate = parseEntryDate(input.date);
  const parsedHours = parseHours(input.hours);
  const isBillable = Boolean(input.billable);

  let resolvedRate: string | null = null;
  let resolvedCurrency: string | null = null;

  if (isBillable) {
    const rawRate = input.hourlyRate ?? null;
    const rawCurrency = input.currency ?? null;

    if (rawRate === null && rawCurrency !== null) {
      throw codedError('Hourly rate is required when currency is specified', 400);
    }

    if (rawRate !== null) {
      resolvedRate = parseHourlyRate(rawRate);
      resolvedCurrency =
        rawCurrency !== null
          ? parseCurrency(rawCurrency)
          : await resolveOrganizationDefaultCurrency(organizationId);
    }
  }

  const timeEntry = (await prisma.timeEntry.create({
    data: {
      organizationId,
      userId: targetUserId,
      projectId: resolvedProjectId,
      taskId: inputTaskId,
      date: parsedDate,
      hours: parsedHours,
      description: input.description ?? null,
      billable: isBillable,
      hourlyRate: resolvedRate,
      currency: resolvedCurrency,
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
      userId: timeEntry.userId,
      projectId: resolvedProjectId,
      taskId: timeEntry.taskId,
      hours: timeEntry.hours.toString(),
      billable: timeEntry.billable,
      hourlyRate: resolvedRate,
      currency: resolvedCurrency,
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

  const existing = (await prisma.timeEntry.findFirst({
    where: { id, organizationId },
    include: { task: { select: { projectId: true } } },
  })) as {
    id: string;
    organizationId: string;
    userId: string;
    projectId?: string | null;
    taskId: string | null;
    date: Date;
    hours: { toString: () => string };
    description: string | null;
    billable: boolean;
    hourlyRate?: { toString: () => string } | null;
    currency?: string | null;
    task?: { projectId: string } | null;
  } | null;

  if (!existing) {
    throw codedError('Not found', 404);
  }

  const isAdmin =
    existing.userId === userId ? true : await isOrganizationAdmin(userId, organizationId);
  if (!isAdmin) {
    throw codedError('Forbidden: you can only modify your own time entries', 403);
  }

  let nextUserId = existing.userId;
  if (input.userId !== undefined && input.userId !== null && input.userId !== existing.userId) {
    const canReassign = await isOrganizationAdmin(userId, organizationId);
    if (!canReassign) {
      throw codedError('Forbidden: only administrators can reassign time entry ownership', 403);
    }
    const targetUser = await prisma.user.findFirst({
      where: { id: input.userId, organizationId },
    });
    if (!targetUser) {
      throw codedError('User not found', 404);
    }
    nextUserId = input.userId;
  }

  const existingProjectId = existing.projectId ?? existing.task?.projectId ?? null;
  const taskFieldProvided = input.taskId !== undefined;
  const projectFieldProvided = input.projectId !== undefined;
  const nextTaskId = taskFieldProvided ? (input.taskId ?? null) : existing.taskId;
  let nextProjectId = existingProjectId;

  if (nextTaskId !== null) {
    if (taskFieldProvided) {
      const task = await prisma.task.findFirst({
        where: { id: nextTaskId, organizationId },
        include: { project: { select: { id: true, status: true, deletedAt: true } } },
      });
      if (!task || !task.project || task.project.deletedAt) {
        throw codedError('Task not found', 404);
      }
      const taskProjectId = task.projectId ?? task.project.id ?? null;
      const isLinkingDifferentTask = nextTaskId !== existing.taskId;
      const isLinkingDifferentProject =
        projectFieldProvided && input.projectId !== existingProjectId;
      if (
        task.project.status === 'archived' &&
        (isLinkingDifferentTask || isLinkingDifferentProject)
      ) {
        throw codedError('Cannot link a time entry to an archived project', 400);
      }
      if (projectFieldProvided) {
        if (input.projectId === null) {
          throw codedError('Cannot unlink project while entry is attached to a task', 400);
        }
        if (taskProjectId && input.projectId !== taskProjectId) {
          throw codedError('Task does not belong to the specified project', 400);
        }
      }
      nextProjectId = taskProjectId ?? input.projectId ?? existingProjectId;
    } else if (input.projectId !== undefined) {
      if (input.projectId === null) {
        throw codedError('Cannot unlink project while entry is attached to a task', 400);
      }
      const taskProjectId = existing.task?.projectId ?? existing.projectId ?? null;
      if (taskProjectId && input.projectId !== taskProjectId) {
        throw codedError('Task does not belong to the specified project', 400);
      }
      nextProjectId = input.projectId;
    }
  } else if (projectFieldProvided) {
    if (input.projectId === null) {
      nextProjectId = null;
    } else {
      const project = await prisma.project.findFirst({
        where: { id: input.projectId, organizationId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!project) {
        throw codedError('Project not found', 404);
      }
      if (project.status === 'archived' && input.projectId !== existingProjectId) {
        throw codedError('Cannot link a time entry to an archived project', 400);
      }
      nextProjectId = project.id;
    }
  }

  const nextDate = input.date ? parseEntryDate(input.date) : existing.date;
  const nextHours = input.hours !== undefined ? parseHours(input.hours) : existing.hours;
  const nextBillable = input.billable !== undefined ? input.billable : existing.billable;

  let nextHourlyRate: string | null = null;
  let nextCurrency: string | null = null;

  if (!nextBillable) {
    const rateProvided = input.hourlyRate !== undefined && input.hourlyRate !== null;
    const currencyProvided = input.currency !== undefined && input.currency !== null;
    if (input.billable === undefined && (rateProvided || currencyProvided)) {
      throw codedError('Billing rate and currency require the entry to be billable', 400);
    }
    nextHourlyRate = null;
    nextCurrency = null;
  } else {
    const rateProvided = input.hourlyRate !== undefined;
    const currencyProvided = input.currency !== undefined;

    const existingRate =
      existing.hourlyRate !== null && existing.hourlyRate !== undefined
        ? normalizeHourlyRateText(existing.hourlyRate.toString())
        : null;
    const existingCurrency = existing.currency ?? null;

    if (rateProvided && input.hourlyRate === null && !currencyProvided) {
      nextHourlyRate = null;
      nextCurrency = null;
    } else {
      const candidateRate = rateProvided ? input.hourlyRate : existingRate;
      const candidateCurrency = currencyProvided ? input.currency : existingCurrency;

      if (candidateRate === null || candidateRate === undefined) {
        if (candidateCurrency !== null && candidateCurrency !== undefined) {
          throw codedError('Hourly rate is required when currency is specified', 400);
        }
        nextHourlyRate = null;
        nextCurrency = null;
      } else {
        nextHourlyRate = parseHourlyRate(candidateRate);
        nextCurrency =
          candidateCurrency !== null && candidateCurrency !== undefined
            ? parseCurrency(candidateCurrency)
            : await resolveOrganizationDefaultCurrency(organizationId);
      }
    }
  }

  const timeEntry = (await prisma.timeEntry.update({
    where: { id },
    data: {
      userId: nextUserId,
      projectId: nextProjectId,
      taskId: nextTaskId,
      date: nextDate,
      hours: nextHours,
      description: input.description !== undefined ? input.description : existing.description,
      billable: nextBillable,
      hourlyRate: nextHourlyRate,
      currency: nextCurrency,
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
      userId: existing.userId,
      projectId: existingProjectId,
      taskId: existing.taskId,
      hours: existing.hours.toString(),
      billable: existing.billable,
      hourlyRate:
        existing.hourlyRate !== null && existing.hourlyRate !== undefined
          ? normalizeHourlyRateText(existing.hourlyRate.toString())
          : null,
      currency: existing.currency ?? null,
    },
    after: {
      id: timeEntry.id,
      userId: timeEntry.userId,
      projectId: nextProjectId,
      taskId: timeEntry.taskId,
      hours: timeEntry.hours.toString(),
      billable: timeEntry.billable,
      hourlyRate: nextHourlyRate,
      currency: nextCurrency,
    },
    organizationId,
  });

  return serializeTimeEntry(timeEntry);
}

export async function deleteTimeEntry(id: string): Promise<{ id: string }> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'time.entry.delete');

  const existing = (await prisma.timeEntry.findFirst({
    where: { id, organizationId },
  })) as {
    id: string;
    userId: string;
    projectId?: string | null;
    taskId: string | null;
    hours: { toString: () => string };
    billable: boolean;
  } | null;

  if (!existing) {
    throw codedError('Not found', 404);
  }

  const canDelete =
    existing.userId === userId ? true : await isOrganizationAdmin(userId, organizationId);
  if (!canDelete) {
    throw codedError('Forbidden: you can only delete your own time entries', 403);
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
    before: {
      id: existing.id,
      userId: existing.userId,
      projectId: existing.projectId ?? null,
      taskId: existing.taskId,
      hours: existing.hours.toString(),
      billable: existing.billable,
    },
    after: null,
    organizationId,
  });

  return { id };
}
