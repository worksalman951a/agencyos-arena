/**
 * Client-portal invitation concurrency (Phase 4D / Batch 4C-2).
 *
 * The vulnerability this suite covers: `createClientInvitation` asked "is there
 * a pending invitation for this address?", then inserted. Two requests that
 * interleaved between those two statements both saw "no" and both inserted, so
 * one administrator (or two instances) could end up with two pending
 * invitations, two usable tokens and two e-mails for the same recipient.
 *
 * The fix is a database invariant - the partial unique index
 * `ClientInvitation_pending_org_email_key` (migration `0020`) - so these tests
 * drive real PostgreSQL, real transactions and real HTTP, never a sequential
 * simulation of concurrency:
 *
 *  1. simultaneous creation for the same recipient;
 *  2. exactly one permitted live invitation (and one usable token);
 *  3. exactly one e-mail dispatched (transport stubbed, one real insert);
 *  4. cross-organization independence for the same address;
 *  5. replacement of expired and revoked invitations, without deleting history;
 *  6. acceptance and replay protection under simultaneous requests;
 *  7. the verified-email ownership gate is unchanged;
 *  8. unauthorized attempts (anonymous, client identity, other tenant);
 *  9. client-portal identity isolation (no membership, no roles, no admin API);
 * 10. the index itself rejecting genuine concurrent inserts, and being
 *     reversible.
 *
 * Requires DATABASE_URL and a running server on TEST_SERVER_URL /
 * BETTER_AUTH_URL (default http://localhost:3001). Skips when no database is
 * configured.
 */

import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The in-process half of this suite drives the service directly against the
// real database. Only the two boundaries that cannot exist outside a request -
// the session cookie and the session lookup - and the SMTP transport are
// replaced; authorization, tenant scoping, transactions and the index are real.
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/lib/email/invitation-emails', () => ({ sendClientInvitationEmail: vi.fn() }));

import { cookies } from 'next/headers';

import { auth } from '@/lib/auth-server';
import { prisma } from '@/lib/db';
import { sendClientInvitationEmail } from '@/lib/email/invitation-emails';
import { createClientInvitation } from '@/lib/services/portal/client-invitation-service';

import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';
const SUFFIX = randomUUID().slice(0, 8);
const EMAIL_DOMAIN = `invitation-race-${SUFFIX}@integration.agencyos.invalid`;

const ORIGIN_HEADERS = { Origin: SERVER_URL };

const PENDING_INDEX = 'ClientInvitation_pending_org_email_key';

const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockSendInvitationEmail = sendClientInvitationEmail as unknown as ReturnType<typeof vi.fn>;

type JsonResult = {
  status: number;
  // Every assertion below narrows the shape it needs; typing this as `unknown`
  // would only add casts without adding safety.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
  json: any;
  text: string;
  headers: Headers;
};

async function api(
  token: string | null,
  pathname: string,
  init: { method?: string; body?: unknown } = {}
): Promise<JsonResult> {
  const headers: Record<string, string> = { Accept: 'application/json', ...ORIGIN_HEADERS };
  if (token) headers.Cookie = `better-auth.session_token=${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${SERVER_URL}${pathname}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'manual',
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function signUp(email: string, name: string): Promise<string> {
  const signUpRes = await api(null, '/api/auth/sign-up/email', {
    method: 'POST',
    body: { email, password: TEST_PASSWORD, name },
  });
  expect(signUpRes.status, `sign-up for ${email}: ${signUpRes.text}`).toBe(200);

  const signInRes = await api(null, '/api/auth/sign-in/email', {
    method: 'POST',
    body: { email, password: TEST_PASSWORD },
  });
  expect(signInRes.status, `sign-in for ${email}: ${signInRes.text}`).toBe(200);

  // Models a fixture whose mailbox ownership was already proved; the dedicated
  // ownership case below explicitly reverses it.
  await prisma.user.update({ where: { email }, data: { emailVerified: true } });

  const setCookie = signInRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
  expect(match, `session cookie for ${email}`).toBeTruthy();
  return decodeURIComponent(match![1]);
}

async function signUpWithOrg(email: string, name: string, orgName: string) {
  const token = await signUp(email, name);
  const bootstrap = await api(token, '/api/auth/bootstrap-organization', {
    method: 'POST',
    body: { organizationName: orgName },
  });
  expect(bootstrap.status, `bootstrap for ${email}: ${bootstrap.text}`).toBe(200);

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const organization = await prisma.organization.findFirstOrThrow({
    where: { userRoles: { some: { userId: user.id } } },
    select: { id: true },
  });
  return { token, user, organizationId: organization.id };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Pending rows for one recipient, read straight from the table. */
async function pendingCount(organizationId: string, email: string) {
  return prisma.clientInvitation.count({
    where: {
      organizationId,
      email: { equals: email, mode: 'insensitive' },
      status: 'pending',
    },
  });
}

describeIfDb('Client invitation concurrency (real PostgreSQL)', () => {
  let agencyToken = '';
  let agencyOrgId = '';
  let agencyUserId = '';
  let otherAgencyToken = '';
  let otherAgencyOrgId = '';

  const createdOrgIds: string[] = [];
  const emails: string[] = [];

  /** Create a CRM contact in the caller's organization and return its id. */
  async function freshContact(email: string, token = agencyToken): Promise<string> {
    const contact = await api(token, '/api/v1/crm/contacts', {
      method: 'POST',
      body: { firstName: 'Rae', lastName: 'Recipient', email },
    });
    expect(contact.status, contact.text).toBe(201);
    return contact.json.id as string;
  }

  async function invite(
    email: string,
    contactId: string,
    role = 'client_viewer',
    token = agencyToken
  ): Promise<JsonResult> {
    return api(token, '/api/v1/admin/client-invitations', {
      method: 'POST',
      body: { email, contactId, role },
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await fetch(`${SERVER_URL}/api/auth/session`, { headers: { Accept: 'application/json' } });

    const agency = await signUpWithOrg(
      `agency-a-${EMAIL_DOMAIN}`,
      'Race Agency A',
      `Invitation Race A ${SUFFIX}`
    );
    agencyToken = agency.token;
    agencyOrgId = agency.organizationId;
    agencyUserId = agency.user.id;

    const other = await signUpWithOrg(
      `agency-b-${EMAIL_DOMAIN}`,
      'Race Agency B',
      `Invitation Race B ${SUFFIX}`
    );
    otherAgencyToken = other.token;
    otherAgencyOrgId = other.organizationId;

    createdOrgIds.push(agencyOrgId, otherAgencyOrgId);
    emails.push(agency.user.email, other.user.email);
  });

  afterAll(async () => {
    for (const email of emails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.session.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      }
    }
    for (const orgId of createdOrgIds) {
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }, 120_000);

  describe('simultaneous invitation creation', () => {
    it('permits exactly one of eight concurrent invitations for the same recipient', async () => {
      const email = `same-recipient-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);

      const responses = await Promise.all(
        Array.from({ length: 8 }, () => invite(email, contactId))
      );

      const created = responses.filter((response) => response.status === 201);
      const conflicted = responses.filter((response) => response.status === 409);

      expect(created, responses.map((r) => `${r.status}:${r.text}`).join(' | ')).toHaveLength(1);
      expect(conflicted).toHaveLength(7);
      for (const response of conflicted) {
        expect(response.json.error).toBe('A pending invitation already exists for this address');
        expect(response.json).not.toHaveProperty('token');
        expect(response.json).not.toHaveProperty('acceptPath');
      }

      // One live invitation, one usable token, one audit trail entry.
      const rows = await prisma.clientInvitation.findMany({
        where: { organizationId: agencyOrgId, email },
        select: { id: true, status: true, tokenHash: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].tokenHash).toBe(hashToken(created[0].json.token));
      expect(await pendingCount(agencyOrgId, email)).toBe(1);

      const audit = await prisma.auditLog.findMany({
        where: {
          organizationId: agencyOrgId,
          entityType: 'ClientInvitation',
          entityId: rows[0].id,
          action: 'client.invitation.create',
        },
      });
      expect(audit).toHaveLength(1);
    });

    it('rejects the losing request at the database even when the pre-check cannot see the winner', async () => {
      // A second connection holds an uncommitted live invitation. Every
      // "is there a pending invitation?" read is blind to it, so the HTTP
      // request below is decided by the index - after waiting for the lock.
      const email = `uncommitted-winner-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);

      const winner = prisma.$transaction(async (tx: typeof prisma) => {
        const created = await tx.clientInvitation.create({
          data: {
            organizationId: agencyOrgId,
            email,
            contactId,
            tokenHash: hashToken(`uncommitted-${SUFFIX}`),
            status: 'pending',
            role: 'client_viewer',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            invitedBy: agencyUserId,
          },
        });
        // Long enough that the request below reaches its INSERT while the row
        // is still invisible to it.
        await new Promise((resolve) => setTimeout(resolve, 900));
        return created;
      });

      const startedAt = Date.now();
      const response = await invite(email, contactId);
      const elapsed = Date.now() - startedAt;
      await winner;

      expect(response.status, response.text).toBe(409);
      expect(response.json).not.toHaveProperty('token');
      // It had to wait for the competitor's transaction, which is only true if
      // the insert was attempted (the pre-check returns immediately).
      expect(elapsed).toBeGreaterThan(400);
      expect(await pendingCount(agencyOrgId, email)).toBe(1);
    });

    it('keeps the same recipient independent across organizations', async () => {
      const sharedEmail = `shared-recipient-${EMAIL_DOMAIN}`;
      const contactHere = await freshContact(sharedEmail);
      const contactThere = await freshContact(sharedEmail, otherAgencyToken);

      const [here, there] = await Promise.all([
        invite(sharedEmail, contactHere),
        invite(sharedEmail, contactThere, 'client_viewer', otherAgencyToken),
      ]);

      expect(here.status, here.text).toBe(201);
      expect(there.status, there.text).toBe(201);
      expect(here.json.token).not.toBe(there.json.token);
      expect(await pendingCount(agencyOrgId, sharedEmail)).toBe(1);
      expect(await pendingCount(otherAgencyOrgId, sharedEmail)).toBe(1);
    });

    it('does not constrain different recipients in the same organization', async () => {
      const first = `independent-a-${EMAIL_DOMAIN}`;
      const second = `independent-b-${EMAIL_DOMAIN}`;
      const firstContact = await freshContact(first);
      const secondContact = await freshContact(second);

      const responses = await Promise.all([
        invite(first, firstContact),
        invite(second, secondContact),
      ]);

      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      expect(await pendingCount(agencyOrgId, first)).toBe(1);
      expect(await pendingCount(agencyOrgId, second)).toBe(1);
    });
  });

  describe('expired and revoked invitation replacement', () => {
    it('replaces an expired invitation and keeps it as history', async () => {
      const email = `expired-replacement-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);

      const first = await invite(email, contactId);
      expect(first.status, first.text).toBe(201);

      // Age the invitation past its window exactly as time would.
      await prisma.clientInvitation.update({
        where: { id: first.json.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const second = await invite(email, contactId);
      expect(second.status, second.text).toBe(201);
      expect(second.json.token).not.toBe(first.json.token);

      const rows = await prisma.clientInvitation.findMany({
        where: { organizationId: agencyOrgId, email },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, tokenHash: true, expiresAt: true },
      });
      expect(rows).toHaveLength(2);
      // The old row is retired, not deleted or rewritten: same id, same token
      // hash, same expiry, and its link is dead.
      expect(rows[0]).toMatchObject({
        id: first.json.id,
        status: 'expired',
        tokenHash: hashToken(first.json.token),
      });
      expect(rows[0].expiresAt.getTime()).toBeLessThan(Date.now());
      expect(rows[1]).toMatchObject({ status: 'pending', tokenHash: hashToken(second.json.token) });

      const oldToken = await api(null, `/api/v1/portal/invitations/${first.json.token}`);
      expect(oldToken.status).toBe(410);
      expect(await pendingCount(agencyOrgId, email)).toBe(1);
    });

    it('replaces a revoked invitation and keeps the revocation', async () => {
      const email = `revoked-replacement-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);

      const first = await invite(email, contactId);
      expect(first.status, first.text).toBe(201);

      const revoked = await api(
        agencyToken,
        `/api/v1/admin/client-invitations/${first.json.id}/revoke`,
        { method: 'POST' }
      );
      expect(revoked.status, revoked.text).toBe(200);

      const second = await invite(email, contactId);
      expect(second.status, second.text).toBe(201);

      const rows = await prisma.clientInvitation.findMany({
        where: { organizationId: agencyOrgId, email },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, revokedAt: true },
      });
      expect(rows.map((row: { status: string }) => row.status)).toEqual(['revoked', 'pending']);
      expect(rows[0].revokedAt).not.toBeNull();
      expect(await pendingCount(agencyOrgId, email)).toBe(1);
    });
  });

  describe('acceptance and ownership under concurrency', () => {
    it('lets exactly one of two simultaneous acceptances create the portal identity', async () => {
      const email = `accept-race-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);
      const created = await invite(email, contactId);
      expect(created.status, created.text).toBe(201);

      const token = await signUp(email, 'Accept Race');
      emails.push(email);

      const attempts = await Promise.all([
        api(token, `/api/v1/portal/invitations/${created.json.token}/accept`, { method: 'POST' }),
        api(token, `/api/v1/portal/invitations/${created.json.token}/accept`, { method: 'POST' }),
      ]);

      expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 410]);
      const accepted = attempts.find((attempt) => attempt.status === 200)!;
      expect(accepted.json.clientAccessId).toBeTruthy();

      // The user may hold one portal identity, never two - and it is the one the
      // winning response names.
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const identities = await prisma.clientAccess.findMany({
        where: { userId: user.id },
        select: { id: true },
      });
      expect(identities).toHaveLength(1);
      expect(identities[0].id).toBe(accepted.json.clientAccessId);

      const row = await prisma.clientInvitation.findUniqueOrThrow({
        where: { id: created.json.id },
      });
      expect(row.status).toBe('accepted');

      // The identity is a client: no membership, no roles, no admin API.
      expect(user.userType).toBe('client');
      expect(user.organizationId).toBeNull();
      expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(0);

      const forbiddenCreate = await invite(
        `client-cannot-invite-${EMAIL_DOMAIN}`,
        contactId,
        'client_viewer',
        token
      );
      expect(forbiddenCreate.status).toBe(403);
      const forbiddenList = await api(token, '/api/v1/admin/client-invitations');
      expect(forbiddenList.status).toBe(403);
    });

    it('requires proven email ownership before the invitation can be consumed', async () => {
      const email = `ownership-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);
      const created = await invite(email, contactId);
      expect(created.status, created.text).toBe(201);

      const token = await signUp(email, 'Unproven Owner');
      emails.push(email);
      // Ownership was not proved: the gate must hold and the invitation must
      // stay usable once it is. (The proof itself -
      // lib/services/auth/email-verification-service - is exercised by
      // portal.integration.test.ts and auth.email-verification.integration.test.ts.)
      await prisma.user.update({ where: { email }, data: { emailVerified: false } });

      const denied = await api(token, `/api/v1/portal/invitations/${created.json.token}/accept`, {
        method: 'POST',
      });
      expect(denied.status).toBe(403);
      expect(
        (await prisma.clientInvitation.findUniqueOrThrow({ where: { id: created.json.id } })).status
      ).toBe('pending');

      await prisma.user.update({ where: { email }, data: { emailVerified: true } });

      const accepted = await api(token, `/api/v1/portal/invitations/${created.json.token}/accept`, {
        method: 'POST',
      });
      expect(accepted.status, accepted.text).toBe(200);
    });
  });

  describe('unauthorized invitation attempts', () => {
    it('rejects an anonymous creation and stores nothing', async () => {
      const email = `anonymous-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);

      const response = await invite(email, contactId, 'client_viewer', '');
      expect(response.status).toBe(401);
      expect(response.json).not.toHaveProperty('token');
      expect(await pendingCount(agencyOrgId, email)).toBe(0);
    });

    it('rejects a contact that belongs to another organization (404, no row)', async () => {
      const email = `cross-tenant-${EMAIL_DOMAIN}`;
      const otherContactId = await freshContact(email, otherAgencyToken);

      // Agency A cannot invite agency B's contact, whatever id it is given.
      const response = await invite(email, otherContactId);
      expect(response.status).toBe(404);
      expect(response.json).not.toHaveProperty('token');
      expect(await pendingCount(agencyOrgId, email)).toBe(0);
      expect(await pendingCount(otherAgencyOrgId, email)).toBe(0);
    });

    it('rejects an invitation e-mail that is not the contact e-mail', async () => {
      const email = `mismatch-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);

      const response = await invite(`someone-else-${EMAIL_DOMAIN}`, contactId);
      expect(response.status).toBe(400);
      expect(await pendingCount(agencyOrgId, email)).toBe(0);
    });
  });

  describe('database enforcement under genuine concurrent transactions', () => {
    it('lets exactly one of six concurrent inserts commit', async () => {
      const email = `direct-inserts-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);

      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, (_, index) =>
          prisma.clientInvitation.create({
            data: {
              organizationId: agencyOrgId,
              email,
              contactId,
              tokenHash: hashToken(`direct-${SUFFIX}-${index}`),
              status: 'pending',
              role: 'client_viewer',
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
              invitedBy: agencyUserId,
            },
          })
        )
      );

      const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
      const rejected = attempts.filter(
        (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected'
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(5);
      for (const rejection of rejected) {
        const error = rejection.reason as { code?: string; message?: string };
        expect(error.code).toBe('P2002');
        expect(error.message).toContain(PENDING_INDEX);
      }
      expect(await pendingCount(agencyOrgId, email)).toBe(1);
    });

    it('is reversible and idempotent, and the DDL leaves the table unchanged', async () => {
      const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
         WHERE tablename = 'ClientInvitation' AND indexname = ${PENDING_INDEX}
      `;
      expect(indexes).toHaveLength(1);

      const before = await prisma.clientInvitation.count();

      // Re-running the migration's statement is a no-op (IF NOT EXISTS) and the
      // rollback statement is safe at any time. Both happen in a transaction
      // that is always rolled back, so the suite leaves the schema untouched -
      // exactly like the finance-uniqueness suite does for migration 0015.
      await expect(
        prisma.$transaction(async (tx: typeof prisma) => {
          await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "${PENDING_INDEX}"`);
          await tx.$executeRawUnsafe(
            `CREATE UNIQUE INDEX IF NOT EXISTS "${PENDING_INDEX}"
               ON "ClientInvitation" ("organizationId", lower(email))
              WHERE status = 'pending'`
          );
          throw new Error('rollback');
        })
      ).rejects.toThrow('rollback');

      expect(await prisma.clientInvitation.count()).toBe(before);
      const stillThere = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
         WHERE tablename = 'ClientInvitation' AND indexname = ${PENDING_INDEX}
      `;
      expect(stillThere).toHaveLength(1);
    });
  });

  describe('e-mail dispatch under simultaneous creation', () => {
    const SENT = { status: 'sent', messageId: '<race@example.test>', attempts: 1 };

    beforeEach(() => {
      mockCookies.mockResolvedValue({ toString: () => 'better-auth.session_token=in-process' });
      mockGetSession.mockResolvedValue({
        session: { id: `session-${SUFFIX}` },
        user: { id: agencyUserId, email: `agency-a-${EMAIL_DOMAIN}` },
      });
      mockSendInvitationEmail.mockResolvedValue(SENT);
    });

    it('dispatches one e-mail and hands out one token when six creations race', async () => {
      const email = `email-race-${EMAIL_DOMAIN}`;
      const contactId = await freshContact(email);

      mockSendInvitationEmail.mockClear();

      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          createClientInvitation({ email, contactId, role: 'client_viewer' })
        )
      );

      const fulfilled = attempts.filter(
        (
          attempt
        ): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof createClientInvitation>>> =>
          attempt.status === 'fulfilled'
      );
      const rejected = attempts.filter(
        (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected'
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(5);
      for (const rejection of rejected) {
        expect(rejection.reason).toMatchObject({ statusCode: 409 });
      }

      // The transport saw exactly one message: a losing request never sends.
      expect(mockSendInvitationEmail).toHaveBeenCalledTimes(1);
      expect(fulfilled[0].value.emailDelivery).toEqual({ status: 'sent' });
      expect(await pendingCount(agencyOrgId, email)).toBe(1);

      const rows = await prisma.clientInvitation.findMany({
        where: { organizationId: agencyOrgId, email },
        select: { tokenHash: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(hashToken(fulfilled[0].value.token));

      // Only the winner is audited as created, and only it has a delivery.
      const created = await prisma.auditLog.count({
        where: {
          organizationId: agencyOrgId,
          entityType: 'ClientInvitation',
          action: 'client.invitation.create',
          after: { path: ['email'], equals: email },
        },
      });
      expect(created).toBe(1);
    });
  });
});
