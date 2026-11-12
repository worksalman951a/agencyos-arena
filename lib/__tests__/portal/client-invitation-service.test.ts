/**
 * Unit tests for client-portal invitations.
 *
 * Focus: the properties that make an invitation safe to send by e-mail — hashed
 * token, expiry, revocation, single use (replay), e-mail binding, and the refusal
 * to convert an internal team member (or another client) into a client of this
 * organization.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    contact: { findFirst: vi.fn() },
    clientAccess: { findFirst: vi.fn(), findUnique: vi.fn() },
    clientInvitation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    userRole: { count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth-server', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/portal/audit', () => ({ writePortalAudit: vi.fn() }));
vi.mock('@/lib/portal/notify', () => ({ notifyUser: vi.fn(), notifyInternalStaff: vi.fn() }));
vi.mock('@/lib/portal/internal-actor', () => ({ requireInternalActor: vi.fn() }));
// The sender is replaced, so no test in this file can send e-mail. Its own
// behaviour is covered in lib/__tests__/email/.
vi.mock('@/lib/email/invitation-emails', () => ({ sendClientInvitationEmail: vi.fn() }));

import { createHash } from 'node:crypto';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';

import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { sendClientInvitationEmail } from '@/lib/email/invitation-emails';
import { writePortalAudit } from '@/lib/portal/audit';
import { requireInternalActor } from '@/lib/portal/internal-actor';
import {
  acceptClientInvitation,
  createClientInvitation,
  getClientInvitationByToken,
  revokeClientInvitation,
} from '@/lib/services/portal/client-invitation-service';

const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockRequireInternalActor = requireInternalActor as unknown as ReturnType<typeof vi.fn>;
const mockSendInvitationEmail = sendClientInvitationEmail as unknown as ReturnType<typeof vi.fn>;
const mockWritePortalAudit = writePortalAudit as unknown as ReturnType<typeof vi.fn>;
const mockUserFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockContactFindFirst = prisma.contact.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAccessFindFirst = prisma.clientAccess.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAccessFindUnique = prisma.clientAccess.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockInvitationFindUnique = prisma.clientInvitation.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const mockInvitationFindFirst = prisma.clientInvitation.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockInvitationCreate = prisma.clientInvitation.create as unknown as ReturnType<typeof vi.fn>;
const mockInvitationUpdate = prisma.clientInvitation.update as unknown as ReturnType<typeof vi.fn>;
const mockInvitationUpdateMany = prisma.clientInvitation.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockUserRoleCount = prisma.userRole.count as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

const organizationId = 'org_1';
const rawToken = 'a'.repeat(43);

function hash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invitation_1',
    organizationId,
    email: 'clara@client.test',
    contactId: 'contact_1',
    accountId: null,
    tokenHash: hash(rawToken),
    status: 'pending',
    role: 'client_approver',
    canViewInvoices: true,
    canDownloadFiles: true,
    canComment: true,
    canApprove: true,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    invitedBy: 'admin_1',
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    ...overrides,
  };
}

const ACTOR = {
  userId: 'admin_1',
  organizationId,
  email: 'admin@agency.test',
  role: 'employee',
};

const CONTACT = {
  id: 'contact_1',
  email: 'clara@client.test',
  firstName: 'Clara',
  lastName: 'Client',
  accountId: 'account_1',
  organization: { name: 'Acme Agency' },
};

/** A request that passes every check of `createClientInvitation`. */
function arrangeInvitationCreation() {
  vi.resetAllMocks();
  mockRequireInternalActor.mockResolvedValue(ACTOR);
  mockContactFindFirst.mockResolvedValue(CONTACT);
  mockAccessFindFirst.mockResolvedValue(null);
  mockInvitationFindFirst.mockResolvedValue(null);
  mockInvitationCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'invitation_1',
    createdAt: new Date(),
    ...data,
  }));
  mockWritePortalAudit.mockResolvedValue(undefined);
  // What the sender answers when e-mail delivery is switched off (the default).
  mockSendInvitationEmail.mockResolvedValue({ status: 'disabled' });
}

describe('createClientInvitation', () => {
  beforeEach(() => {
    arrangeInvitationCreation();
  });

  it('stores only the SHA-256 hash of the token and returns the raw token once', async () => {
    const result = await createClientInvitation({
      email: 'clara@client.test',
      contactId: 'contact_1',
      role: 'client_approver',
    });

    const stored = mockInvitationCreate.mock.calls[0][0].data as { tokenHash: string };

    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.tokenHash).not.toBe(result.token);
    expect(stored.tokenHash).toBe(hash(result.token));
    expect(JSON.stringify(stored)).not.toContain(result.token);
    expect(result.acceptPath).toBe(`/portal/invite/${result.token}`);
  });

  it('never stores an organization role or membership', async () => {
    await createClientInvitation({
      email: 'clara@client.test',
      contactId: 'contact_1',
      role: 'client_viewer',
    });

    const stored = mockInvitationCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(stored).not.toHaveProperty('roleId');
    expect(stored.role).toBe('client_viewer');
  });

  it('rejects an e-mail that does not match the CRM contact', async () => {
    await expect(
      createClientInvitation({
        email: 'someone-else@client.test',
        contactId: 'contact_1',
        role: 'client_viewer',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a contact from another organization (404, no disclosure)', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_other_tenant',
        role: 'client_viewer',
      })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockContactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId }),
      })
    );
  });

  it('rejects a contact that already has active portal access', async () => {
    mockAccessFindFirst.mockResolvedValue({ id: 'access_1', status: 'active' });

    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_1',
        role: 'client_viewer',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a second live invitation for the same address', async () => {
    mockInvitationFindFirst.mockResolvedValue({
      id: 'invitation_live',
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_1',
        role: 'client_viewer',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects unknown or privileged fields in the payload', async () => {
    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_1',
        role: 'client_viewer',
        organizationId: 'org_other',
      } as unknown)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an internal role value', async () => {
    await expect(
      createClientInvitation({
        email: 'clara@client.test',
        contactId: 'contact_1',
        role: 'administrator',
      } as unknown)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('createClientInvitation: e-mail delivery', () => {
  const input = { email: 'clara@client.test', contactId: 'contact_1', role: 'client_approver' };
  const SENT = { status: 'sent', messageId: '<message-1@example.test>', attempts: 1 };

  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    arrangeInvitationCreation();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  function auditActions(): string[] {
    return mockWritePortalAudit.mock.calls.map((call) => (call[0] as { action: string }).action);
  }

  it('e-mails the invitation last: after authorization, the tenant-scoped checks and the insert', async () => {
    const order: string[] = [];
    mockRequireInternalActor.mockImplementation(async (permission: string) => {
      order.push(`authorize:${permission}`);
      return ACTOR;
    });
    mockContactFindFirst.mockImplementation(async () => {
      order.push('contact');
      return CONTACT;
    });
    mockAccessFindFirst.mockImplementation(async () => {
      order.push('no-active-access');
      return null;
    });
    mockInvitationFindFirst.mockImplementation(async () => {
      order.push('no-live-invitation');
      return null;
    });
    mockInvitationCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      order.push('store');
      return { id: 'invitation_1', createdAt: new Date(), ...data };
    });
    mockWritePortalAudit.mockImplementation(async (entry: { action: string }) => {
      order.push(`audit:${entry.action}`);
    });
    mockSendInvitationEmail.mockImplementation(async () => {
      order.push('email');
      return SENT;
    });

    await createClientInvitation(input);

    expect(order).toEqual([
      'authorize:client.invitation.create',
      'contact',
      'no-active-access',
      'no-live-invitation',
      'store',
      'audit:client.invitation.create',
      'email',
      'audit:client.invitation.email_sent',
    ]);
  });

  it('takes the recipient, the organization and the link from its own records', async () => {
    const result = await createClientInvitation(input);
    const stored = mockInvitationCreate.mock.calls[0][0].data as { expiresAt: Date };

    expect(mockSendInvitationEmail).toHaveBeenCalledTimes(1);
    expect(mockSendInvitationEmail).toHaveBeenCalledWith({
      // The session's organization - the payload cannot name one (see below).
      organizationId,
      // Read through the contact, which was looked up inside that organization.
      organizationName: 'Acme Agency',
      // The address stored on the invitation.
      to: 'clara@client.test',
      recipientName: 'Clara',
      acceptPath: `/portal/invite/${result.token}`,
      expiresAt: stored.expiresAt,
    });
    expect(mockContactFindFirst).toHaveBeenCalledWith({
      where: { id: 'contact_1', organizationId, deletedAt: null },
      select: expect.objectContaining({ organization: { select: { name: true } } }),
    });
  });

  it('e-mails the address stored on the invitation, in its normalized form', async () => {
    await createClientInvitation({ ...input, email: '  Clara@Client.TEST ' });

    const stored = mockInvitationCreate.mock.calls[0][0].data as { email: string };
    expect(mockSendInvitationEmail.mock.calls[0][0].to).toBe(stored.email);
    expect(stored.email).toBe('clara@client.test');
  });

  describe('sends nothing when the invitation is not created', () => {
    const refusals: Array<[string, () => void, unknown, number | undefined]> = [
      ['the payload is invalid', () => undefined, { email: 'not-an-address' }, 400],
      [
        'the payload names an organization',
        () => undefined,
        { ...input, organizationId: 'org_other' },
        400,
      ],
      [
        'the payload asks for an internal role',
        () => undefined,
        { ...input, role: 'administrator' },
        400,
      ],
      [
        'the caller is not signed in',
        () =>
          mockRequireInternalActor.mockRejectedValue(
            Object.assign(new Error('Unauthenticated'), { statusCode: 401 })
          ),
        input,
        401,
      ],
      [
        'the caller lacks the permission, or is a client identity',
        () =>
          mockRequireInternalActor.mockRejectedValue(
            Object.assign(new Error('Forbidden'), { statusCode: 403 })
          ),
        input,
        403,
      ],
      [
        'the contact belongs to another organization',
        () => mockContactFindFirst.mockResolvedValue(null),
        { ...input, contactId: 'contact_other_tenant' },
        404,
      ],
      [
        'the address is not the address of the contact',
        () => undefined,
        { ...input, email: 'attacker@evil.example' },
        400,
      ],
      [
        'the contact already has portal access',
        () => mockAccessFindFirst.mockResolvedValue({ id: 'access_1', status: 'active' }),
        input,
        409,
      ],
      [
        'a live invitation already exists for the address',
        () =>
          mockInvitationFindFirst.mockResolvedValue({
            id: 'invitation_live',
            expiresAt: new Date(Date.now() + 60_000),
          }),
        input,
        409,
      ],
      [
        'the invitation cannot be stored',
        () => mockInvitationCreate.mockRejectedValue(new Error('database unavailable')),
        input,
        undefined,
      ],
      [
        'its creation cannot be audited',
        () => mockWritePortalAudit.mockRejectedValue(new Error('database unavailable')),
        input,
        undefined,
      ],
    ];

    it.each(refusals)('%s', async (_label, arrange, payload, statusCode) => {
      arrange();

      const attempt = createClientInvitation(payload);

      await (statusCode
        ? expect(attempt).rejects.toMatchObject({ statusCode })
        : expect(attempt).rejects.toThrow());
      expect(mockSendInvitationEmail).not.toHaveBeenCalled();
    });
  });

  it('reports an accepted e-mail in the response and in the audit trail', async () => {
    mockSendInvitationEmail.mockResolvedValue({ ...SENT, attempts: 2 });

    const result = await createClientInvitation(input);

    expect(result.emailDelivery).toEqual({ status: 'sent' });
    expect(auditActions()).toEqual(['client.invitation.create', 'client.invitation.email_sent']);
    expect(mockWritePortalAudit).toHaveBeenLastCalledWith({
      organizationId,
      actorId: 'admin_1',
      actorName: 'admin@agency.test',
      action: 'client.invitation.email_sent',
      entityType: 'ClientInvitation',
      entityId: 'invitation_1',
      after: { messageId: '<message-1@example.test>', attempts: 2 },
    });
  });

  it.each([
    'configuration',
    'invalid_message',
    'rate_limited',
    'connection',
    'timeout',
    'tls',
    'authentication',
    'rejected',
    'unknown',
  ])('reports a "%s" failure truthfully and still hands over the invitation', async (reason) => {
    mockSendInvitationEmail.mockResolvedValue({ status: 'failed', reason, attempts: 1 });

    const result = await createClientInvitation(input);

    // The invitation stands and its link is returned once, exactly as before.
    expect(result.status).toBe('pending');
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.acceptPath).toBe(`/portal/invite/${result.token}`);
    // ...and nothing anywhere says the e-mail went out.
    expect(result.emailDelivery).toEqual({ status: 'failed', reason });
    expect(auditActions()).toEqual(['client.invitation.create', 'client.invitation.email_failed']);
    expect(mockWritePortalAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'client.invitation.email_failed',
        entityId: 'invitation_1',
        after: { reason, attempts: 1 },
      })
    );
  });

  it('reports disabled delivery as disabled and records no delivery', async () => {
    const result = await createClientInvitation(input);

    expect(result.emailDelivery).toEqual({ status: 'disabled' });
    expect(auditActions()).toEqual(['client.invitation.create']);
  });

  it('only adds a field to the response; everything that was returned still is', async () => {
    const result = await createClientInvitation(input);

    expect(result).toEqual({
      id: 'invitation_1',
      email: 'clara@client.test',
      contactId: 'contact_1',
      contactName: 'Clara Client',
      status: 'pending',
      role: 'client_approver',
      expiresAt: expect.any(Date),
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      acceptPath: `/portal/invite/${result.token}`,
      emailDelivery: { status: 'disabled' },
    });
  });

  it('still returns the invitation when the delivery outcome cannot be audited', async () => {
    mockSendInvitationEmail.mockResolvedValue(SENT);
    mockWritePortalAudit
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('database unavailable'));

    const result = await createClientInvitation(input);

    expect(result.emailDelivery).toEqual({ status: 'sent' });
    expect(result.token).toBeTruthy();
    expect(consoleError.mock.calls).toEqual([
      [
        '[email] could not record a delivery outcome in the audit trail',
        { entityType: 'ClientInvitation', entityId: 'invitation_1', event: 'email_sent' },
      ],
    ]);
  });

  it('still returns the invitation if the sender itself fails, and reports no delivery', async () => {
    mockSendInvitationEmail.mockRejectedValue(new Error('unexpected'));

    const result = await createClientInvitation(input);

    expect(result.token).toBeTruthy();
    expect(result.emailDelivery).toEqual({ status: 'failed', reason: 'unknown' });
    expect(auditActions()).toEqual(['client.invitation.create', 'client.invitation.email_failed']);
  });

  it('keeps the token and the link out of the audit trail and the log', async () => {
    const outcomes = [
      SENT,
      { status: 'failed', reason: 'rejected', attempts: 1 },
      { status: 'disabled' },
    ];
    const tokens: string[] = [];
    for (const outcome of outcomes) {
      mockSendInvitationEmail.mockResolvedValueOnce(outcome);
      tokens.push((await createClientInvitation(input)).token);
    }
    mockSendInvitationEmail.mockRejectedValueOnce(
      new Error(`failed for /portal/invite/${tokens[0]}`)
    );
    tokens.push((await createClientInvitation(input)).token);

    const recorded = JSON.stringify([mockWritePortalAudit.mock.calls, consoleError.mock.calls]);
    for (const token of tokens) expect(recorded).not.toContain(token);
    expect(recorded).not.toContain('/portal/invite/');
    // The delivery entries do not repeat the address either.
    const deliveryEntries = mockWritePortalAudit.mock.calls
      .map((call) => call[0] as { action: string })
      .filter((entry) => entry.action.includes('email_'));
    expect(deliveryEntries.length).toBe(3);
    expect(JSON.stringify(deliveryEntries)).not.toContain('clara@client.test');
  });

  it('still hands over the invitation if the organization name is unavailable', async () => {
    mockContactFindFirst.mockResolvedValue({ ...CONTACT, organization: undefined });

    const result = await createClientInvitation(input);

    expect(result.token).toBeTruthy();
    expect(mockSendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, organizationName: '' })
    );
  });

  it('sends exactly one e-mail per invitation', async () => {
    mockSendInvitationEmail.mockResolvedValue(SENT);

    await createClientInvitation(input);

    expect(mockSendInvitationEmail).toHaveBeenCalledTimes(1);
  });

  it('does not e-mail when an invitation is revoked', async () => {
    mockInvitationFindFirst.mockResolvedValue(invitation());
    mockInvitationUpdate.mockResolvedValue({ id: 'invitation_1', status: 'revoked' });

    await revokeClientInvitation('invitation_1');

    expect(mockSendInvitationEmail).not.toHaveBeenCalled();
  });
});

describe('getClientInvitationByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers 404 for an unknown token', async () => {
    mockInvitationFindUnique.mockResolvedValue(null);

    await expect(getClientInvitationByToken(rawToken)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('looks the invitation up by hash, never by raw token', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation(),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });

    await getClientInvitationByToken(rawToken);

    expect(mockInvitationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hash(rawToken) } })
    );
  });

  it('answers 410 for an expired invitation and records the expiry', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation({ expiresAt: new Date(Date.now() - 1000) }),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });
    mockInvitationUpdateMany.mockResolvedValue({ count: 1 });

    await expect(getClientInvitationByToken(rawToken)).rejects.toMatchObject({ statusCode: 410 });
    expect(mockInvitationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'invitation_1', status: 'pending' },
      data: { status: 'expired' },
    });
  });

  it('answers 410 for a revoked invitation', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation({ status: 'revoked' }),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });

    await expect(getClientInvitationByToken(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('answers 410 for an already accepted invitation (replay)', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation({ status: 'accepted' }),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });

    await expect(getClientInvitationByToken(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('discloses only invitee-facing fields', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      ...invitation(),
      organization: { name: 'Acme Agency' },
      contact: { firstName: 'Clara', lastName: 'Client' },
    });

    const result = await getClientInvitationByToken(rawToken);

    expect(result).toEqual({
      id: 'invitation_1',
      email: 'clara@client.test',
      organizationName: 'Acme Agency',
      contactName: 'Clara Client',
      expiresAt: expect.any(Date),
      capabilities: expect.arrayContaining(['approve work']),
    });
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).not.toHaveProperty('organizationId');
  });
});

describe('acceptClientInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ toString: () => 'better-auth.session_token=token' });
    mockGetSession.mockResolvedValue({
      session: { id: 'session_1' },
      user: { id: 'user_client_1', email: 'clara@client.test' },
    });
    mockInvitationFindUnique.mockResolvedValue(invitation());
    mockUserFindUnique.mockResolvedValue({
      id: 'user_client_1',
      organizationId: null,
      userType: 'internal',
      status: 'active',
    });
    mockUserRoleCount.mockResolvedValue(0);
    mockAccessFindUnique.mockResolvedValue(null);
    mockInvitationUpdateMany.mockResolvedValue({ count: 1 });

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        clientInvitation: {
          updateMany: mockInvitationUpdateMany,
        },
        clientAccess: {
          findUnique: mockAccessFindUnique,
          create: vi.fn().mockResolvedValue({ id: 'access_1', organizationId }),
        },
        user: { update: vi.fn().mockResolvedValue({}) },
      })
    );
  });

  it('rejects an unauthenticated acceptance with 401', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects acceptance by a different e-mail address with 403', async () => {
    mockGetSession.mockResolvedValue({
      session: { id: 'session_1' },
      user: { id: 'user_other', email: 'someone@else.test' },
    });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects an internal team member so a session cannot be converted', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'user_client_1',
      organizationId,
      userType: 'internal',
      status: 'active',
    });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a user that already holds an organization role', async () => {
    mockUserRoleCount.mockResolvedValue(1);

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a disabled account', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'user_client_1',
      organizationId: null,
      userType: 'internal',
      status: 'disabled',
    });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a replayed acceptance with 410 when the claim loses the race', async () => {
    mockInvitationUpdateMany.mockResolvedValue({ count: 0 });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('rejects a second portal identity for the same user with 409', async () => {
    mockAccessFindUnique.mockResolvedValue({ id: 'access_existing' });

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('claims the invitation atomically and creates a client identity with no organization', async () => {
    const createdAccess: Array<Record<string, unknown>> = [];
    const updatedUser: Array<Record<string, unknown>> = [];

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        clientInvitation: { updateMany: mockInvitationUpdateMany },
        clientAccess: {
          findUnique: mockAccessFindUnique,
          create: vi
            .fn()
            .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
              createdAccess.push(data);
              return { id: 'access_1', organizationId };
            }),
        },
        user: {
          update: vi
            .fn()
            .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
              updatedUser.push(data);
              return {};
            }),
        },
      })
    );

    const result = await acceptClientInvitation(rawToken);

    expect(result).toEqual({ clientAccessId: 'access_1', organizationId });

    // The claim is conditional: only a still-pending, still-valid row is consumed.
    expect(mockInvitationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'invitation_1', status: 'pending', expiresAt: { gt: expect.any(Date) } },
      data: {
        status: 'accepted',
        acceptedAt: expect.any(Date),
        acceptedByUserId: 'user_client_1',
      },
    });

    expect(createdAccess[0]).toMatchObject({
      organizationId,
      userId: 'user_client_1',
      contactId: 'contact_1',
      status: 'active',
      canApprove: true,
    });

    // The identity is a client and is kept out of every organization.
    expect(updatedUser[0]).toMatchObject({
      userType: 'client',
      organizationId: null,
      status: 'active',
    });
  });

  it('answers 410 for an expired invitation', async () => {
    mockInvitationFindUnique.mockResolvedValue(
      invitation({ expiresAt: new Date(Date.now() - 1000) })
    );

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('answers 410 for a revoked invitation', async () => {
    mockInvitationFindUnique.mockResolvedValue(invitation({ status: 'revoked' }));

    await expect(acceptClientInvitation(rawToken)).rejects.toMatchObject({ statusCode: 410 });
  });
});

describe('revokeClientInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireInternalActor.mockResolvedValue({
      userId: 'admin_1',
      organizationId,
      email: 'admin@agency.test',
      role: 'employee',
    });
  });

  it('scopes the lookup to the actor organization', async () => {
    mockInvitationFindFirst.mockResolvedValue(null);

    await expect(revokeClientInvitation('invitation_other_tenant')).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockInvitationFindFirst).toHaveBeenCalledWith({
      where: { id: 'invitation_other_tenant', organizationId },
    });
  });

  it('refuses to revoke an already accepted invitation', async () => {
    mockInvitationFindFirst.mockResolvedValue(invitation({ status: 'accepted' }));

    await expect(revokeClientInvitation('invitation_1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('revokes a pending invitation', async () => {
    mockInvitationFindFirst.mockResolvedValue(invitation());
    mockInvitationUpdate.mockResolvedValue({ id: 'invitation_1', status: 'revoked' });

    const result = await revokeClientInvitation('invitation_1');

    expect(result).toEqual({ id: 'invitation_1', status: 'revoked' });
    expect(mockInvitationUpdate).toHaveBeenCalledWith({
      where: { id: 'invitation_1' },
      data: { status: 'revoked', revokedAt: expect.any(Date) },
    });
  });
});
