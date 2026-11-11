'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  documentLinkCreateSchema,
  salesDocumentShareLinkCreateSchema,
} from '@/lib/schemas/documents/link.schema';
import { normalizeOrganizationSettings } from '@/lib/schemas/settings/organization.schema';
import { randomBytes } from 'crypto';

const SHARED_DOC_FOLDER = '__shared__';

interface DocumentLinkRecord {
  id: string;
  organizationId: string;
  documentId: string;
  token: string;
  expiresAt: Date;
  accessCount: number;
  maxAccess: number | null;
  createdAt: Date;
  document: { id: string; title: string; type: string };
}

export interface DocumentLinkResponse {
  id: string;
  organizationId: string;
  documentId: string;
  documentTitle: string;
  documentType: string;
  token: string;
  url: string;
  publicUrl: string;
  expiresAt: Date;
  accessCount: number;
  maxAccess: number | null;
  createdAt: Date;
}

export interface SharedDocumentPublicSnapshot {
  entityType?: 'proposal' | 'quotation' | 'estimate' | 'contract';
  number?: string | null;
  title: string;
  status: string;
  currency?: string | null;
  validUntil?: string | null;
  subtotal?: string | null;
  tax?: string | null;
  total?: string | null;
  notes?: string | null;
  clientName?: string | null;
  signedAt?: string | null;
  signatureReference?: string | null;
  items?: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    taxRate: string;
    amount: string;
  }>;
  branding?: {
    brandName: string;
    brandColor: string;
    logoUrl: string | null;
  };
}

function codedError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function formatMoneyValue(value: { toString: () => string } | number | string): string {
  const num = Number(
    typeof value === 'string' || typeof value === 'number' ? value : value.toString()
  );
  return Number.isFinite(num) ? num.toFixed(2) : String(value);
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

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

interface RawLineItemSummary {
  description: string;
  quantity: { toString: () => string } | number | string;
  unitPrice: { toString: () => string } | number | string;
  taxRate: { toString: () => string } | number | string;
  amount: { toString: () => string } | number | string;
}

async function resolvePublicBranding(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, settings: true },
  });
  const normalized = normalizeOrganizationSettings(org?.settings ?? {});
  return {
    brandName: normalized.brandName || org?.name || 'AgencyOS',
    brandColor: normalized.brandColor || '#2563eb',
    logoUrl: normalized.logoUrl ?? null,
  };
}

export async function createDocumentLink(input: {
  documentId: string;
  expiresAt: string;
  maxAccess?: number | null;
}): Promise<DocumentLinkResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.share');

  const parsed = documentLinkCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw codedError(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const { data } = parsed;

  // Validate document belongs to same org
  const document = await prisma.document.findFirst({
    where: { id: data.documentId, organizationId },
  });

  if (!document) {
    throw codedError('Document not found', 404);
  }

  const token = generateToken();
  const expiresAt = new Date(data.expiresAt);

  const link = await prisma.documentLink.create({
    data: {
      organizationId,
      documentId: data.documentId,
      token,
      expiresAt,
      maxAccess: data.maxAccess ?? null,
      createdBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'document.link.create',
    entityType: 'DocumentLink',
    entityId: link.id,
    after: {
      documentId: data.documentId,
      expiresAt: link.expiresAt,
      maxAccess: link.maxAccess,
    },
    organizationId,
  });

  return {
    id: link.id,
    organizationId: link.organizationId,
    documentId: link.documentId,
    documentTitle: document.title,
    documentType: document.type,
    token: link.token,
    url: `/api/v1/documents/links/${link.token}`,
    publicUrl: `/share/${link.token}`,
    expiresAt: link.expiresAt,
    accessCount: link.accessCount,
    maxAccess: link.maxAccess,
    createdAt: link.createdAt,
  };
}

/**
 * Create a secure, expiring client share link for a Proposal, Quotation,
 * Estimate, or Contract. Stores a sanitized, read-only snapshot in an
 * org-scoped DocumentVersion so no internal organization IDs or CRM keys leak.
 */
export async function createSalesDocumentShareLink(input: {
  entityType: 'proposal' | 'quotation' | 'estimate' | 'contract';
  entityId: string;
  expiresAt: string;
  maxAccess?: number | null;
}): Promise<DocumentLinkResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.share');

  const parsed = salesDocumentShareLinkCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw codedError(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const { entityType, entityId, expiresAt: expiresAtStr, maxAccess } = parsed.data;
  await requirePermission(userId, organizationId, `${entityType}.read`);

  const branding = await resolvePublicBranding(organizationId);
  let docTitle = '';
  let snapshot: SharedDocumentPublicSnapshot;

  if (entityType === 'proposal') {
    const proposal = await prisma.proposal.findFirst({
      where: { id: entityId, organizationId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        contact: { select: { firstName: true, lastName: true } },
      },
    });
    if (!proposal || proposal.deletedAt) {
      throw codedError('Proposal not found', 404);
    }
    docTitle = `${proposal.number} — ${proposal.title}`;
    const clientName = proposal.contact
      ? [proposal.contact.firstName, proposal.contact.lastName].filter(Boolean).join(' ')
      : null;
    snapshot = {
      entityType: 'proposal',
      number: proposal.number,
      title: proposal.title,
      status: proposal.status,
      currency: proposal.currency,
      validUntil: proposal.validUntil ? proposal.validUntil.toISOString() : null,
      subtotal: formatMoneyValue(proposal.subtotal),
      tax: formatMoneyValue(proposal.tax),
      total: formatMoneyValue(proposal.total),
      notes: proposal.notes,
      clientName,
      items: (proposal.items as RawLineItemSummary[]).map((item: RawLineItemSummary) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unitPrice: formatMoneyValue(item.unitPrice),
        taxRate: item.taxRate.toString(),
        amount: formatMoneyValue(item.amount),
      })),
      branding,
    };
  } else if (entityType === 'quotation') {
    const quotation = await prisma.quotation.findFirst({
      where: { id: entityId, organizationId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        contact: { select: { firstName: true, lastName: true } },
      },
    });
    if (!quotation || quotation.deletedAt) {
      throw codedError('Quotation not found', 404);
    }
    docTitle = `${quotation.number} — ${quotation.title}`;
    const clientName = quotation.contact
      ? [quotation.contact.firstName, quotation.contact.lastName].filter(Boolean).join(' ')
      : null;
    snapshot = {
      entityType: 'quotation',
      number: quotation.number,
      title: quotation.title,
      status: quotation.status,
      currency: quotation.currency,
      validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : null,
      subtotal: formatMoneyValue(quotation.subtotal),
      tax: formatMoneyValue(quotation.tax),
      total: formatMoneyValue(quotation.total),
      notes: quotation.notes,
      clientName,
      items: (quotation.items as RawLineItemSummary[]).map((item: RawLineItemSummary) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unitPrice: formatMoneyValue(item.unitPrice),
        taxRate: item.taxRate.toString(),
        amount: formatMoneyValue(item.amount),
      })),
      branding,
    };
  } else if (entityType === 'estimate') {
    const estimate = await prisma.estimate.findFirst({
      where: { id: entityId, organizationId },
    });
    if (!estimate) {
      throw codedError('Estimate not found', 404);
    }
    const contact = await prisma.contact.findFirst({
      where: { id: estimate.clientId, organizationId, deletedAt: null },
      select: { firstName: true, lastName: true },
    });
    docTitle = `${estimate.number} — Estimate`;
    const clientName = contact
      ? [contact.firstName, contact.lastName].filter(Boolean).join(' ')
      : null;
    snapshot = {
      entityType: 'estimate',
      number: estimate.number,
      title: `Estimate ${estimate.number}`,
      status: estimate.status,
      currency: estimate.currency,
      validUntil: estimate.validUntil ? estimate.validUntil.toISOString() : null,
      subtotal: formatMoneyValue(estimate.total),
      tax: '0.00',
      total: formatMoneyValue(estimate.total),
      notes: estimate.notes,
      clientName,
      branding,
    };
  } else {
    const contract = await prisma.contract.findFirst({
      where: { id: entityId, organizationId },
      include: {
        proposal: { select: { number: true, title: true } },
        project: { select: { name: true } },
      },
    });
    if (!contract) {
      throw codedError('Contract not found', 404);
    }
    docTitle = contract.title;
    const summaryLines = [
      contract.proposal
        ? `Linked Proposal: ${contract.proposal.number} (${contract.proposal.title})`
        : null,
      contract.project ? `Linked Project: ${contract.project.name}` : null,
    ].filter(Boolean);
    snapshot = {
      entityType: 'contract',
      number: contract.proposal?.number ?? null,
      title: contract.title,
      status: contract.status,
      notes: summaryLines.length > 0 ? summaryLines.join('\n') : null,
      signedAt: contract.signedAt ? contract.signedAt.toISOString() : null,
      signatureReference: contract.signatureReference,
      branding,
    };
  }

  const document = await prisma.document.create({
    data: {
      organizationId,
      title: docTitle,
      type: entityType,
      folder: SHARED_DOC_FOLDER,
      visibility: 'shared',
      version: 1,
    },
  });

  await prisma.documentVersion.create({
    data: {
      organizationId,
      documentId: document.id,
      version: 1,
      title: docTitle,
      snapshot: snapshot as unknown as Record<string, unknown>,
      createdBy: userId,
    },
  });

  const token = generateToken();
  const expiresAt = new Date(expiresAtStr);

  const link = await prisma.documentLink.create({
    data: {
      organizationId,
      documentId: document.id,
      token,
      expiresAt,
      maxAccess: maxAccess ?? null,
      createdBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'document.link.create',
    entityType: 'DocumentLink',
    entityId: link.id,
    after: {
      documentId: document.id,
      sourceEntityType: entityType,
      sourceEntityId: entityId,
      expiresAt: link.expiresAt,
      maxAccess: link.maxAccess,
    },
    organizationId,
  });

  return {
    id: link.id,
    organizationId: link.organizationId,
    documentId: link.documentId,
    documentTitle: document.title,
    documentType: document.type,
    token: link.token,
    url: `/api/v1/documents/links/${link.token}`,
    publicUrl: `/share/${link.token}`,
    expiresAt: link.expiresAt,
    accessCount: link.accessCount,
    maxAccess: link.maxAccess,
    createdAt: link.createdAt,
  };
}

export async function listDocumentLinks(): Promise<DocumentLinkResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.read');

  const links = (await prisma.documentLink.findMany({
    where: { organizationId },
    include: {
      document: { select: { id: true, title: true, type: true } },
    },
    orderBy: { createdAt: 'desc' },
  })) as DocumentLinkRecord[];

  return links.map((l) => ({
    id: l.id,
    organizationId: l.organizationId,
    documentId: l.documentId,
    documentTitle: l.document.title,
    documentType: l.document.type,
    token: l.token,
    url: `/api/v1/documents/links/${l.token}`,
    publicUrl: `/share/${l.token}`,
    expiresAt: l.expiresAt,
    accessCount: l.accessCount,
    maxAccess: l.maxAccess,
    createdAt: l.createdAt,
  }));
}

export async function revokeDocumentLink(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'document.share');

  const existing = await prisma.documentLink.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw codedError('Link not found', 404);
  }

  // Set expiry to 1 second in the past so immediate subsequent accesses see an expired link
  const revokedAt = new Date(Date.now() - 1000);
  await prisma.documentLink.update({
    where: { id },
    data: { expiresAt: revokedAt },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'document.link.revoke',
    entityType: 'DocumentLink',
    entityId: id,
    before: { id, expiresAt: existing.expiresAt },
    after: { id, expiresAt: revokedAt },
    organizationId,
  });

  return { id };
}

export async function verifyDocumentLink(token: string) {
  const link = await prisma.documentLink.findFirst({
    where: { token },
    include: {
      document: {
        include: {
          versions: { orderBy: { version: 'desc' }, take: 1 },
        },
      },
    },
  });

  if (!link) {
    throw codedError('Invalid link', 404);
  }

  const now = new Date();
  if (link.expiresAt <= now) {
    throw codedError('Link expired', 410);
  }

  if (link.maxAccess !== null && link.accessCount >= link.maxAccess) {
    throw codedError('Link access limit reached', 403);
  }

  // Atomic check-and-increment when updateMany is available (real Prisma client),
  // so concurrent accesses can never exceed maxAccess.
  const linkModel = prisma.documentLink as unknown as {
    updateMany?: (args: unknown) => Promise<{ count: number }>;
    update: (args: unknown) => Promise<unknown>;
  };

  if (typeof linkModel.updateMany === 'function') {
    const updated = await linkModel.updateMany({
      where: {
        id: link.id,
        expiresAt: { gt: now },
        ...(link.maxAccess !== null ? { accessCount: { lt: link.maxAccess } } : {}),
      },
      data: { accessCount: { increment: 1 } },
    });

    if (updated.count === 0) {
      const fresh = await prisma.documentLink.findFirst({ where: { id: link.id } });
      if (!fresh || fresh.expiresAt <= new Date()) {
        throw codedError('Link expired', 410);
      }
      throw codedError('Link access limit reached', 403);
    }
  } else {
    await prisma.documentLink.update({
      where: { id: link.id },
      data: { accessCount: { increment: 1 } },
    });
  }

  const rawSnapshot = link.document.versions?.[0]?.snapshot;
  const snapshot =
    rawSnapshot && typeof rawSnapshot === 'object' && !Array.isArray(rawSnapshot)
      ? (rawSnapshot as unknown as SharedDocumentPublicSnapshot)
      : null;

  // Anonymous callers only need the document they were granted; the
  // organization id and internal actors stay strictly internal.
  return {
    id: link.id,
    documentId: link.documentId,
    documentTitle: link.document.title,
    documentType: link.document.type,
    expiresAt: link.expiresAt,
    accessCount: link.accessCount + 1,
    maxAccess: link.maxAccess,
    snapshot,
  };
}
