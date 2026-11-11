'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';

interface ProposalVersionRecord {
  id: string;
  organizationId: string;
  proposalId: string;
  version: number;
  title: string;
  status: string;
  subtotal: { toString: () => string };
  tax: { toString: () => string };
  total: { toString: () => string };
  currency: string;
  notes: string | null;
  snapshot?: unknown;
  createdAt: Date;
  createdBy: string | null;
}

interface DocumentVersionRecord {
  id: string;
  organizationId: string;
  documentId: string;
  version: number;
  title: string;
  fileAssetId: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface ProposalVersionResponse {
  id: string;
  organizationId: string;
  proposalId: string;
  version: number;
  title: string;
  status: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface DocumentVersionResponse {
  id: string;
  organizationId: string;
  documentId: string;
  version: number;
  title: string;
  fileAssetId: string | null;
  createdAt: Date;
  createdBy: string | null;
}

function codedError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
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

/** Create a versioned snapshot of a proposal (including line items) */
export async function createProposalVersion(proposalId: string): Promise<ProposalVersionResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'proposal.update');

  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, organizationId },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!proposal || proposal.deletedAt) {
    throw codedError('Proposal not found', 404);
  }

  // Get next version number
  const lastVersion = await prisma.proposalVersion.findFirst({
    where: { proposalId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const nextVersion = (lastVersion?.version ?? 0) + 1;

  const version = await prisma.proposalVersion.create({
    data: {
      organizationId,
      proposalId,
      version: nextVersion,
      title: proposal.title,
      status: proposal.status,
      subtotal: proposal.subtotal,
      tax: proposal.tax,
      total: proposal.total,
      currency: proposal.currency,
      notes: proposal.notes,
      snapshot: {
        number: proposal.number,
        title: proposal.title,
        status: proposal.status,
        subtotal: proposal.subtotal.toString(),
        tax: proposal.tax.toString(),
        total: proposal.total.toString(),
        currency: proposal.currency,
        validUntil: proposal.validUntil ? proposal.validUntil.toISOString() : null,
        notes: proposal.notes,
        items: (
          (proposal.items ?? []) as Array<{
            description: string;
            quantity: { toString: () => string };
            unitPrice: { toString: () => string };
            taxRate: { toString: () => string };
            amount: { toString: () => string };
            sortOrder: number;
          }>
        ).map((item) => ({
          description: item.description,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          taxRate: item.taxRate.toString(),
          amount: item.amount.toString(),
          sortOrder: item.sortOrder,
        })),
      },
      createdBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'proposal.version',
    entityType: 'ProposalVersion',
    entityId: version.id,
    after: {
      proposalId,
      version: nextVersion,
    },
    organizationId,
  });

  return {
    id: version.id,
    organizationId: version.organizationId,
    proposalId: version.proposalId,
    version: version.version,
    title: version.title,
    status: version.status,
    subtotal: version.subtotal.toString(),
    tax: version.tax.toString(),
    total: version.total.toString(),
    currency: version.currency,
    notes: version.notes,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
  };
}

export async function listProposalVersions(proposalId: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'proposal.read');

  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, organizationId },
  });

  if (!proposal || proposal.deletedAt) {
    throw codedError('Proposal not found', 404);
  }

  const versions = await prisma.proposalVersion.findMany({
    where: { proposalId },
    orderBy: { version: 'desc' },
    include: {
      creator: { select: { id: true, name: true, email: true } },
    },
  });

  return versions.map((v: ProposalVersionRecord) => ({
    id: v.id,
    organizationId: v.organizationId,
    proposalId: v.proposalId,
    version: v.version,
    title: v.title,
    status: v.status,
    subtotal: v.subtotal.toString(),
    tax: v.tax.toString(),
    total: v.total.toString(),
    currency: v.currency,
    notes: v.notes,
    createdAt: v.createdAt,
    createdBy: v.createdBy,
  }));
}

export async function listDocumentVersions(documentId: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.read');

  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId },
  });

  if (!document) {
    throw codedError('Document not found', 404);
  }

  const versions = await prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { version: 'desc' },
    include: {
      creator: { select: { id: true, name: true, email: true } },
    },
  });

  return versions.map((v: DocumentVersionRecord) => ({
    id: v.id,
    organizationId: v.organizationId,
    documentId: v.documentId,
    version: v.version,
    title: v.title,
    fileAssetId: v.fileAssetId,
    createdAt: v.createdAt,
    createdBy: v.createdBy,
  }));
}
