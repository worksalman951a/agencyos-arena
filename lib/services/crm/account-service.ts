'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  AccountCreateInput,
  AccountUpdateInput,
  AccountQueryInput,
} from '@/lib/schemas/crm/account.schema';

/** Account serialization */
export interface AccountResponse {
  id: string;
  organizationId: string;
  name: string;
  website: string | null;
  address: string | null;
  status: string;
  contactCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Validate session and resolve authorized user context */
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

/** Create an audit log entry with sensitive values redacted */
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

/** Build where clause for organization-scoped account queries */
function buildAccountWhere(organizationId: string, input: AccountQueryInput) {
  const where: Record<string, unknown> = {
    organizationId,
  };

  if (!input.includeDeleted) {
    where.deletedAt = null;
  }

  if (input.status) {
    where.status = input.status;
  }

  if (input.search) {
    where.OR = [
      { name: { contains: input.search, mode: 'insensitive' } },
      { address: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/** Serialize an account */
function serializeAccount(
  account: Awaited<
    ReturnType<typeof prisma.agencyAccount.findUnique> & {
      _count?: { contacts: number };
    }
  >
): AccountResponse {
  return {
    id: account.id,
    organizationId: account.organizationId,
    name: account.name,
    website: account.website,
    address: account.address,
    status: account.status,
    contactCount: account._count?.contacts ?? 0,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    deletedAt: account.deletedAt,
  };
}

/** List accounts with organization scoping, soft-delete filtering, and pagination */
export async function listAccounts(input: AccountQueryInput) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'account.read');

  const where = buildAccountWhere(organizationId, input);
  // Independent read-only statements: run concurrently on separate pooled
  // connections. Deliberately not $transaction(): a transaction pins one pg
  // client, Prisma 7 dispatches relation loads concurrently on it, and pg
  // >= 8.22 deprecates overlapping client.query() (hard error in pg 9).
  const [accounts, total] = await Promise.all([
    prisma.agencyAccount.findMany({
      where,
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        _count: {
          select: { contacts: true },
        },
      },
    }),
    prisma.agencyAccount.count({ where }),
  ]);

  return {
    accounts: accounts.map(serializeAccount),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

/** Get a single account by ID with organization isolation (non-disclosing 404 for cross-org) */
export async function getAccount(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'account.read');

  const account = await prisma.agencyAccount.findFirst({
    where: { id, organizationId },
    include: {
      contacts: {
        where: { deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
      _count: {
        select: { contacts: true },
      },
    },
  });

  if (!account) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeAccount(account);
}

/** Create an account with organization scoping and audit logging */
export async function createAccount(input: AccountCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'account.create');

  const account = await prisma.agencyAccount.create({
    data: {
      organizationId,
      name: input.name,
      website: input.website ?? null,
      address: input.address ?? null,
      status: input.status,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'account.create',
    entityType: 'AgencyAccount',
    entityId: account.id,
    after: {
      id: account.id,
      name: account.name,
      website: account.website,
      address: account.address,
      status: account.status,
    },
    organizationId,
  });

  return serializeAccount(account);
}

/** Update an account with organization scoping and audit logging */
export async function updateAccount(id: string, input: AccountUpdateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'account.update');

  const existing = await prisma.agencyAccount.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const account = await prisma.agencyAccount.update({
    where: { id },
    data: {
      name: input.name ?? existing.name,
      website: input.website ?? existing.website,
      address: input.address ?? existing.address,
      status: input.status ?? existing.status,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'account.update',
    entityType: 'AgencyAccount',
    entityId: account.id,
    before: {
      id: existing.id,
      name: existing.name,
      website: existing.website,
      address: existing.address,
      status: existing.status,
    },
    after: {
      id: account.id,
      name: account.name,
      website: account.website,
      address: account.address,
      status: account.status,
    },
    organizationId,
  });

  return serializeAccount(account);
}

/** Soft delete an account (sets deletedAt) with audit logging */
export async function deleteAccount(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'account.delete');

  const existing = await prisma.agencyAccount.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Also soft-delete related contacts
  await prisma.contact.updateMany({
    where: { accountId: id, organizationId, deletedAt: null },
    data: { deletedAt: new Date(), updatedBy: userId },
  });

  const account = await prisma.agencyAccount.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'account.delete',
    entityType: 'AgencyAccount',
    entityId: account.id,
    before: {
      id: existing.id,
      name: existing.name,
      website: existing.website,
      address: existing.address,
      status: existing.status,
    },
    after: null,
    organizationId,
  });

  return { id: account.id, deletedAt: account.deletedAt };
}
