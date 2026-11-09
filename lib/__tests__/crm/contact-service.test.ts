/**
 * Unit tests for Contact service layer.
 *
 * Prisma is mocked so these tests run without a live database.
 * Tests cover:
 * - Organization-scoped queries (org isolation)
 * - Soft-delete filtering
 * - Permission enforcement (401, 403)
 * - Cross-org non-disclosing 404
 * - PII masking in serialized responses
 * - Audit logging with sensitive values redacted
 * - Cross-org account/contact relationship validation
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    contact: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    agencyAccount: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth-server', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
} from '@/lib/services/crm/contact-service';
import type {
  ContactCreateInput,
  ContactUpdateInput,
  ContactQueryInput,
} from '@/lib/schemas/crm/contact.schema';

const mockContactFindMany = prisma.contact.findMany as unknown as ReturnType<typeof vi.fn>;
const mockContactFindFirst = prisma.contact.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockContactCreate = prisma.contact.create as unknown as ReturnType<typeof vi.fn>;
const mockContactUpdate = prisma.contact.update as unknown as ReturnType<typeof vi.fn>;
const mockContactCount = prisma.contact.count as unknown as ReturnType<typeof vi.fn>;
const mockAccountFindFirst = prisma.agencyAccount.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;

const orgId = 'org_123';
const userId = 'user_123';
const contactId = 'contact_123';

const mockSession = {
  session: { id: 'session_123', userId, expiresAt: new Date(Date.now() + 86400000) },
  user: {
    id: userId,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    organizationId: orgId,
  },
};

function mockAuth(user = mockSession.user) {
  mockGetSession.mockResolvedValue({ session: mockSession.session, user });
  mockCookies.mockReturnValue({
    toString: () => 'better-auth.session_token=test',
  });
}

function mockNoAuth() {
  mockGetSession.mockResolvedValue({ session: null, user: null });
  mockCookies.mockReturnValue({
    toString: () => '',
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth();
  mockRequireOrganization.mockResolvedValue({ organizationId: orgId });
  mockRequirePermission.mockResolvedValue(undefined);
  // Default $transaction mock returns [results, count]
  mockTransaction.mockImplementation(([findManyPromise, countPromise]) =>
    Promise.all([findManyPromise, countPromise])
  );
});

describe('Contact service - listContacts', () => {
  it('returns org-scoped contacts with pagination', async () => {
    mockContactFindMany.mockResolvedValue([
      {
        id: contactId,
        organizationId: orgId,
        accountId: null,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phone: '5551234',
        maskedEmail: null,
        maskedPhone: null,
        isMasked: false,
        status: 'active',
        source: null,
        deletedAt: null,
        createdBy: userId,
        updatedBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        account: null,
      },
    ]);
    mockContactCount.mockResolvedValue(1);

    const result = await listContacts({
      page: 1,
      pageSize: 20,
    } as ContactQueryInput);

    expect(mockContactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: orgId, deletedAt: null }),
      })
    );
    expect(result.contacts).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('filters out soft-deleted contacts by default', async () => {
    mockContactFindMany.mockResolvedValue([]);
    mockContactCount.mockResolvedValue(0);

    await listContacts({ page: 1, pageSize: 20 } as ContactQueryInput);

    expect(mockContactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it('includes soft-deleted contacts when includeDeleted is true', async () => {
    mockContactFindMany.mockResolvedValue([]);
    mockContactCount.mockResolvedValue(0);

    await listContacts({ page: 1, pageSize: 20, includeDeleted: true } as ContactQueryInput);

    const whereArg = mockContactFindMany.mock.calls[0][0].where;
    expect(whereArg.deletedAt).toBeUndefined();
  });

  it('throws 401 when unauthenticated', async () => {
    mockNoAuth();
    await expect(listContacts({ page: 1, pageSize: 20 } as ContactQueryInput)).rejects.toThrow(
      'Unauthenticated'
    );
  });

  it('throws 403 when user lacks contact.read permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden: insufficient permissions'), {
        statusCode: 403,
      })
    );
    await expect(listContacts({ page: 1, pageSize: 20 } as ContactQueryInput)).rejects.toThrow(
      'Forbidden'
    );
  });
});

describe('Contact service - getContact', () => {
  it('returns contact for same org', async () => {
    mockContactFindFirst.mockResolvedValue({
      id: contactId,
      organizationId: orgId,
      accountId: null,
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: null,
      maskedEmail: null,
      maskedPhone: null,
      isMasked: false,
      status: 'active',
      source: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      account: null,
      accountContacts: [],
    });

    const result = await getContact(contactId);
    expect(result.id).toBe(contactId);
    expect(mockContactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: contactId, organizationId: orgId },
      })
    );
  });

  it('throws non-disclosing 404 for cross-org contact', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(getContact(contactId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('masks email and phone when isMasked is true', async () => {
    mockContactFindFirst.mockResolvedValue({
      id: contactId,
      organizationId: orgId,
      accountId: null,
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '5551234567',
      maskedEmail: 'j***@example.com',
      maskedPhone: '***4567',
      isMasked: true,
      status: 'active',
      source: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      account: null,
      accountContacts: [],
    });

    const result = await getContact(contactId);
    expect(result.email).toBe('j***@example.com');
    expect(result.phone).toBe('***4567');
    expect(result.isMasked).toBe(true);
  });
});

describe('Contact service - createContact', () => {
  const createInput = {
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane@example.com',
    phone: '5559876543',
    status: 'active',
    source: 'website',
  };

  it('creates contact with organization scoping and PII masking', async () => {
    mockContactCreate.mockResolvedValue({
      id: 'new_contact',
      organizationId: orgId,
      accountId: null,
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      phone: '5559876543',
      maskedEmail: 'j***@example.com',
      maskedPhone: '***6543',
      isMasked: true,
      status: 'active',
      source: 'website',
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await createContact(createInput as ContactCreateInput);

    expect(mockContactCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: orgId,
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          createdBy: userId,
        }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
    expect(result.isMasked).toBe(true);
  });

  it('validates cross-org account relationship', async () => {
    mockAccountFindFirst.mockResolvedValue(null);

    await expect(
      createContact({ ...createInput, accountId: 'foreign_account' } as ContactCreateInput)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('Contact service - updateContact', () => {
  it('updates contact for same org', async () => {
    mockContactFindFirst.mockResolvedValue({
      id: contactId,
      organizationId: orgId,
      accountId: null,
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: null,
      maskedEmail: null,
      maskedPhone: null,
      isMasked: false,
      status: 'active',
      source: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
    });
    mockContactUpdate.mockResolvedValue({
      id: contactId,
      organizationId: orgId,
      accountId: null,
      firstName: 'Johnny',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: null,
      maskedEmail: null,
      maskedPhone: null,
      isMasked: false,
      status: 'active',
      source: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await updateContact(contactId, { firstName: 'Johnny' } as ContactUpdateInput);
    expect(result.firstName).toBe('Johnny');
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('throws non-disclosing 404 for cross-org update', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(
      updateContact(contactId, { firstName: 'Hacker' } as ContactCreateInput)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('Contact service - deleteContact', () => {
  it('soft deletes contact for same org', async () => {
    mockContactFindFirst.mockResolvedValue({
      id: contactId,
      organizationId: orgId,
      accountId: null,
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: null,
      maskedEmail: null,
      maskedPhone: null,
      isMasked: false,
      status: 'active',
      source: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
    });
    mockContactUpdate.mockResolvedValue({
      id: contactId,
      organizationId: orgId,
      deletedAt: new Date(),
      updatedBy: userId,
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit_1' });

    const result = await deleteContact(contactId);
    expect(result.deletedAt).toBeDefined();
    expect(mockContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: contactId },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('throws non-disclosing 404 for cross-org delete', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(deleteContact(contactId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Contact service - audit identity resolution', () => {
  const baseContact = {
    id: contactId,
    organizationId: orgId,
    accountId: null,
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: null,
    maskedEmail: null,
    maskedPhone: null,
    isMasked: false,
    status: 'active',
    source: null,
    deletedAt: null,
    createdBy: userId,
    updatedBy: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
    account: null,
    accountContacts: [],
  };

  it('resolves creator and updater names instead of raw ids', async () => {
    mockContactFindFirst.mockResolvedValue({
      ...baseContact,
      creator: {
        id: userId,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        organizationId: orgId,
      },
      updater: {
        id: 'user_2',
        name: 'Grace Hopper',
        email: 'grace@example.com',
        organizationId: orgId,
      },
    });

    const result = await getContact(contactId);

    expect(result.createdByUser).toEqual({ id: userId, name: 'Ada Lovelace' });
    expect(result.updatedByUser).toEqual({ id: 'user_2', name: 'Grace Hopper' });
  });

  it('falls back to email when the user has no display name', async () => {
    mockContactFindFirst.mockResolvedValue({
      ...baseContact,
      creator: { id: userId, name: null, email: 'noname@example.com', organizationId: orgId },
      updater: null,
    });

    const result = await getContact(contactId);

    expect(result.createdByUser).toEqual({ id: userId, name: 'noname@example.com' });
    expect(result.updatedByUser).toBeNull();
  });

  it('withholds identity when the referenced user belongs to another organization', async () => {
    mockContactFindFirst.mockResolvedValue({
      ...baseContact,
      creator: {
        id: 'user_foreign',
        name: 'Someone Else',
        email: 'else@example.org',
        organizationId: 'org_other',
      },
      updater: {
        id: 'user_foreign_2',
        name: 'Another Person',
        email: 'another@example.org',
        organizationId: 'org_other',
      },
    });

    const result = await getContact(contactId);

    // Organization isolation: no cross-org identity leakage.
    expect(result.createdByUser).toBeNull();
    expect(result.updatedByUser).toBeNull();
    expect(JSON.stringify(result)).not.toContain('Someone Else');
    expect(JSON.stringify(result)).not.toContain('else@example.org');
  });

  it('returns null identities when the relations were not loaded (list view)', async () => {
    mockContactFindFirst.mockResolvedValue({ ...baseContact });

    const result = await getContact(contactId);

    expect(result.createdByUser).toBeNull();
    expect(result.updatedByUser).toBeNull();
    // Raw ids stay in the response so clients can still correlate records.
    expect(result.createdBy).toBe(userId);
  });

  it('selects organizationId with the audit relations so isolation can be enforced', async () => {
    mockContactFindFirst.mockResolvedValue({ ...baseContact });

    await getContact(contactId);

    const call = mockContactFindFirst.mock.calls.at(-1)?.[0] as {
      include: Record<string, { select: Record<string, boolean> }>;
    };
    expect(call.include.creator.select).toEqual({
      id: true,
      name: true,
      email: true,
      organizationId: true,
    });
    expect(call.include.updater.select).toEqual({
      id: true,
      name: true,
      email: true,
      organizationId: true,
    });
  });
});
