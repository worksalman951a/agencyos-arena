'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  PROJECT_APPROVAL_STATUS_VALUES,
  ProjectApprovalCreateInput,
  ProjectApprovalUpdateInput,
} from '@/lib/schemas/projects/project-approval.schema';

interface ProjectApprovalRecord {
  id: string;
  organizationId: string;
  projectId: string;
  contactId: string | null;
  status: string;
  feedback: string | null;
  approvedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  contact?: { id: string; firstName: string | null; lastName: string; email: string | null } | null;
  creator?: { id: string; name: string | null; email: string | null } | null;
  project?: { id: string; name: string } | null;
}

export interface ProjectApprovalResponse {
  id: string;
  organizationId: string;
  projectId: string;
  contactId: string | null;
  status: string;
  feedback: string | null;
  approvedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  contact?: { id: string; firstName: string | null; lastName: string; email: string | null } | null;
  creator?: { id: string; name: string | null; email: string | null } | null;
  project?: { id: string; name: string } | null;
}

const APPROVAL_STATUSES: readonly string[] = PROJECT_APPROVAL_STATUS_VALUES;

const VALID_APPROVAL_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['approved', 'changes_requested', 'rejected'],
  changes_requested: ['pending', 'approved', 'rejected'],
  rejected: ['pending', 'changes_requested'],
  approved: [],
};

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

function serializeApproval(a: ProjectApprovalRecord): ProjectApprovalResponse {
  return {
    id: a.id,
    organizationId: a.organizationId,
    projectId: a.projectId,
    contactId: a.contactId,
    status: a.status,
    feedback: a.feedback,
    approvedAt: a.approvedAt,
    createdBy: a.createdBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    contact: a.contact ?? null,
    creator: a.creator ?? null,
    project: a.project ?? null,
  };
}

export async function listProjectApprovals(projectId?: string): Promise<ProjectApprovalResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.approval.read');

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

  const approvals = (await prisma.projectApproval.findMany({
    where: projectId ? { projectId, organizationId } : { organizationId },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })) as ProjectApprovalRecord[];

  return approvals.map(serializeApproval);
}

export async function getProjectApproval(id: string): Promise<ProjectApprovalResponse> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.approval.read');

  const approval = (await prisma.projectApproval.findFirst({
    where: { id, organizationId },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true } },
    },
  })) as ProjectApprovalRecord | null;

  if (!approval) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeApproval(approval);
}

export async function createProjectApproval(
  input: ProjectApprovalCreateInput
): Promise<ProjectApprovalResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.approval.create');

  if (!APPROVAL_STATUSES.includes(input.status)) {
    const error = new Error(`Invalid approval status: ${input.status}`) as Error & {
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

  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId, deletedAt: null },
    });
    if (!contact) {
      const error = new Error('Contact not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const approval = (await prisma.projectApproval.create({
    data: {
      organizationId,
      projectId: input.projectId,
      contactId: input.contactId ?? null,
      status: input.status,
      feedback: input.feedback ?? null,
      approvedAt: input.status === 'approved' ? new Date() : null,
      createdBy: userId,
    },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true } },
    },
  })) as ProjectApprovalRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'project.approval.create',
    entityType: 'ProjectApproval',
    entityId: approval.id,
    after: {
      id: approval.id,
      projectId: approval.projectId,
      status: approval.status,
    },
    organizationId,
  });

  return serializeApproval(approval);
}

export async function updateProjectApproval(
  id: string,
  input: ProjectApprovalUpdateInput
): Promise<ProjectApprovalResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'project.approval.update');

  const existing = await prisma.projectApproval.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  if (input.status !== undefined && !APPROVAL_STATUSES.includes(input.status)) {
    const error = new Error(`Invalid approval status: ${input.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  if (input.status !== undefined && input.status !== existing.status) {
    const allowed = VALID_APPROVAL_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      const error = new Error(
        `Invalid status transition from ${existing.status} to ${input.status}`
      ) as Error & { statusCode?: number };
      error.statusCode = 400;
      throw error;
    }
  }

  if (input.contactId !== undefined && input.contactId !== null) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId, deletedAt: null },
    });
    if (!contact) {
      const error = new Error('Contact not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  let nextApprovedAt = existing.approvedAt;
  if (input.status === 'approved' && existing.status !== 'approved') {
    nextApprovedAt = new Date();
  } else if (input.status !== undefined && input.status !== 'approved') {
    nextApprovedAt = null;
  }

  const approval = (await prisma.projectApproval.update({
    where: { id },
    data: {
      contactId: input.contactId !== undefined ? input.contactId : existing.contactId,
      status: input.status ?? existing.status,
      feedback: input.feedback !== undefined ? input.feedback : existing.feedback,
      approvedAt: nextApprovedAt,
    },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true } },
    },
  })) as ProjectApprovalRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'project.approval.update',
    entityType: 'ProjectApproval',
    entityId: approval.id,
    before: {
      id: existing.id,
      status: existing.status,
    },
    after: {
      id: approval.id,
      status: approval.status,
    },
    organizationId,
  });

  return serializeApproval(approval);
}
