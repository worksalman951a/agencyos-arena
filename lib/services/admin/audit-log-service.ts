'use server';

/**
 * Administration: audit log viewer.
 *
 * The viewer previously returned the newest 100 rows with no way to narrow them
 * down, which made "who changed this role?" unanswerable. This adds server-side
 * filters (action prefix, entity type, entity id, actor) and pagination, all
 * organization-scoped.
 *
 * Reading the log requires `audit_log.read`; it is never writable through this
 * service — audit rows are appended by the services that perform the change.
 */

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { auditLogQuerySchema } from '@/lib/schemas/admin/member.schema';

export interface AuditLogResponse {
  id: string;
  organizationId: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  actor: { id: string; name: string | null; email: string | null } | null;
}

export interface AuditLogPage {
  logs: AuditLogResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  actions: string[];
}

function codedError(message: string, statusCode: number) {
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

interface AuditLogRecord {
  id: string;
  organizationId: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  actor: { id: string; name: string | null; email: string | null } | null;
}

export async function listAuditLogs(query: unknown = {}): Promise<AuditLogPage> {
  const parsed = auditLogQuerySchema.safeParse(query ?? {});
  if (!parsed.success) throw codedError('Invalid request query', 400);

  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'audit_log.read');

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 50;

  const where: Record<string, unknown> = { organizationId };
  if (parsed.data.action) where.action = { startsWith: parsed.data.action };
  if (parsed.data.entityType) where.entityType = parsed.data.entityType;
  if (parsed.data.entityId) where.entityId = parsed.data.entityId;
  if (parsed.data.actorId) where.actorId = parsed.data.actorId;

  const [logs, total, actionRows] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where: { organizationId },
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    }),
  ]);

  return {
    logs: (logs as AuditLogRecord[]).map((log) => ({
      id: log.id,
      organizationId: log.organizationId,
      actorId: log.actorId,
      actorName: log.actorName,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      before: (log.before ?? null) as Record<string, unknown> | null,
      after: (log.after ?? null) as Record<string, unknown> | null,
      metadata: (log.metadata ?? null) as Record<string, unknown> | null,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt,
      actor: log.actor,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    actions: (actionRows as Array<{ action: string }>).map((row) => row.action),
  };
}
