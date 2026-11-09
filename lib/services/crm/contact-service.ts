'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  ContactCreateInput,
  ContactUpdateInput,
  ContactQueryInput,
} from '@/lib/schemas/crm/contact.schema';

/**
 * Display information for a user referenced by an audit field (`createdBy`,
 * `updatedBy`). Only populated when the referenced user belongs to the same
 * organization as the contact, so identities never cross organization
 * boundaries.
 */
export interface ContactAuditUser {
  id: string;
  /** Full name, falling back to the user's email when no name is set. */
  name: string;
}

/** Contact serialization with PII masking */
export interface ContactResponse {
  id: string;
  organizationId: string;
  accountId: string | null;
  firstName: string | null;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  isMasked: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  /** Resolved creator identity, or null when unavailable/out of organization. */
  createdByUser: ContactAuditUser | null;
  /** Resolved updater identity, or null when unavailable/out of organization. */
  updatedByUser: ContactAuditUser | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Mask an email address for PII protection */
function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 1) return '***@***';
  return `${email[0]}***@${email.slice(atIndex)}`;
}

/** Mask a phone number for PII protection */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return '***';
  return `***${phone.slice(-4)}`;
}

/** Redact sensitive fields in audit log payloads */
function redactPii(data: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...data };
  if (redacted.email) redacted.email = '***@***';
  if (redacted.phone) redacted.phone = '***';
  if (redacted.maskedEmail) redacted.maskedEmail = '***@***';
  if (redacted.maskedPhone) redacted.maskedPhone = '***';
  return redacted;
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
      before: before ? redactPii(before as Record<string, unknown>) : null,
      after: after ? redactPii(after as Record<string, unknown>) : null,
      metadata: metadata ?? null,
      ipAddress,
      userAgent,
      organizationId,
    },
  });
}

/** Build where clause for organization-scoped contact queries */
function buildContactWhere(organizationId: string, input: ContactQueryInput) {
  const where: Record<string, unknown> = {
    organizationId,
  };

  if (!input.includeDeleted) {
    where.deletedAt = null;
  }

  if (input.accountId) {
    where.accountId = input.accountId;
  }

  if (input.status) {
    where.status = input.status;
  }

  if (input.search) {
    where.OR = [
      { firstName: { contains: input.search, mode: 'insensitive' } },
      { lastName: { contains: input.search, mode: 'insensitive' } },
      { email: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/**
 * Resolve an audit user into display information.
 *
 * Returns null when the relation was not loaded, when the user no longer
 * exists (the FK is `onDelete: SetNull`), or when the user belongs to a
 * different organization than the contact. Callers hold `contact.read`, but
 * identity still never leaves the organization boundary.
 */
function serializeAuditUser(
  user:
    | {
        id?: string | null;
        name?: string | null;
        email?: string | null;
        organizationId?: string | null;
      }
    | null
    | undefined,
  contactOrganizationId: string
): ContactAuditUser | null {
  if (!user || typeof user.id !== 'string') return null;
  if (user.organizationId !== contactOrganizationId) return null;

  const name = user.name?.trim() || user.email?.trim() || 'Unknown user';
  return { id: user.id, name };
}

/** Serialize a contact with PII masking applied */
function serializeContact(
  contact: Awaited<ReturnType<typeof prisma.contact.findUnique>>,
  isMasked: boolean
): ContactResponse {
  return {
    id: contact.id,
    organizationId: contact.organizationId,
    accountId: contact.accountId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: isMasked && contact.maskedEmail ? contact.maskedEmail : contact.email,
    phone: isMasked && contact.maskedPhone ? contact.maskedPhone : contact.phone,
    status: contact.status,
    source: contact.source,
    isMasked: contact.isMasked,
    createdBy: contact.createdBy,
    updatedBy: contact.updatedBy,
    createdByUser: serializeAuditUser(contact.creator, contact.organizationId),
    updatedByUser: serializeAuditUser(contact.updater, contact.organizationId),
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    deletedAt: contact.deletedAt,
  };
}

/** List contacts with organization scoping, soft-delete filtering, and pagination */
export async function listContacts(input: ContactQueryInput) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contact.read');

  const where = buildContactWhere(organizationId, input);
  const [contacts, total] = (await prisma.$transaction([
    prisma.contact.findMany({
      where,
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        account: { select: { id: true, name: true } },
      },
    }),
    prisma.contact.count({ where }),
  ])) as [Array<{ isMasked: boolean; [key: string]: unknown }>, number];

  return {
    contacts: contacts.map((c) => serializeContact(c, c.isMasked)),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

/** Get a single contact by ID with organization isolation (non-disclosing 404 for cross-org) */
export async function getContact(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contact.read');

  const contact = await prisma.contact.findFirst({
    where: { id, organizationId },
    include: {
      account: { select: { id: true, name: true } },
      accountContacts: {
        include: {
          account: { select: { id: true, name: true } },
        },
      },
      // Audit identities for the detail view. `organizationId` is selected so
      // serialization can enforce organization isolation before exposing names.
      creator: { select: { id: true, name: true, email: true, organizationId: true } },
      updater: { select: { id: true, name: true, email: true, organizationId: true } },
    },
  });

  if (!contact) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return serializeContact(contact, contact.isMasked);
}

/** Create a contact with organization scoping, PII masking, and audit logging */
export async function createContact(input: ContactCreateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contact.create');

  // Validate cross-org account relationship if accountId is provided
  if (input.accountId) {
    const account = await prisma.agencyAccount.findFirst({
      where: { id: input.accountId, organizationId },
    });
    if (!account) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  const isMasked = input.email != null || input.phone != null;

  const contact = await prisma.contact.create({
    data: {
      organizationId,
      accountId: input.accountId ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      maskedEmail: isMasked ? maskEmail(input.email ?? '') : null,
      maskedPhone: isMasked ? maskPhone(input.phone ?? '') : null,
      isMasked,
      status: input.status,
      source: input.source ?? null,
      createdBy: userId,
      updatedBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'contact.create',
    entityType: 'Contact',
    entityId: contact.id,
    after: {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      accountId: contact.accountId,
      status: contact.status,
    },
    organizationId,
  });

  return serializeContact(contact, contact.isMasked);
}

/** Update a contact with organization scoping, PII masking, and audit logging */
export async function updateContact(id: string, input: ContactUpdateInput) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contact.update');

  // Verify contact exists and belongs to the user's organization
  const existing = await prisma.contact.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // Validate cross-org account relationship if accountId is being changed
  if (input.accountId !== undefined && input.accountId !== null) {
    const account = await prisma.agencyAccount.findFirst({
      where: { id: input.accountId, organizationId },
    });
    if (!account) {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
  }

  // Compute masking for changed fields (server-controlled, not from client)
  const hasPii = (input.email ?? existing.email) != null || (input.phone ?? existing.phone) != null;
  const emailValue = input.email ?? existing.email;
  const phoneValue = input.phone ?? existing.phone;
  const maskedEmail = hasPii && emailValue ? maskEmail(emailValue) : existing.maskedEmail;
  const maskedPhone = hasPii && phoneValue ? maskPhone(phoneValue) : existing.maskedPhone;
  const isMasked = hasPii || existing.isMasked;

  const contact = await prisma.contact.update({
    where: { id },
    data: {
      accountId: input.accountId ?? existing.accountId,
      firstName: input.firstName ?? existing.firstName,
      lastName: input.lastName ?? existing.lastName,
      email: input.email ?? existing.email,
      phone: input.phone ?? existing.phone,
      maskedEmail,
      maskedPhone,
      isMasked,
      status: input.status ?? existing.status,
      source: input.source ?? existing.source,
      updatedBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'contact.update',
    entityType: 'Contact',
    entityId: contact.id,
    before: redactPii({
      id: existing.id,
      firstName: existing.firstName,
      lastName: existing.lastName,
      email: existing.email,
      phone: existing.phone,
      accountId: existing.accountId,
      status: existing.status,
    }),
    after: redactPii({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      accountId: contact.accountId,
      status: contact.status,
    }),
    organizationId,
  });

  return serializeContact(contact, contact.isMasked);
}

/** Soft delete a contact (sets deletedAt) with audit logging */
export async function deleteContact(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contact.delete');

  const existing = await prisma.contact.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const contact = await prisma.contact.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: userId,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'contact.delete',
    entityType: 'Contact',
    entityId: contact.id,
    before: redactPii({
      id: existing.id,
      firstName: existing.firstName,
      lastName: existing.lastName,
      email: existing.email,
      phone: existing.phone,
      accountId: existing.accountId,
      status: existing.status,
    }),
    after: null,
    organizationId,
  });

  return { id: contact.id, deletedAt: contact.deletedAt };
}
