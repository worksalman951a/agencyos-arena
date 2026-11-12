/**
 * Client Portal integration tests (real PostgreSQL + real HTTP).
 *
 * Covers the Phase 4C security surface end to end:
 *  - invitation issue/consume/replay/expiry/revocation, hash-only storage
 *  - activation, portal session, identity segregation from the internal app
 *  - explicit resource grants, authorized vs. forbidden project/document access
 *  - client approvals with recorded identity, append-only history and terminality
 *  - client comments vs. internal-only notes
 *  - authorized binary downloads (capability + live grant + storage confinement)
 *  - suspension and revocation (sessions die, grants close, approvals cancel)
 *  - cross-organization and cross-client isolation, all as non-disclosing 404/403
 *
 * Requires DATABASE_URL, BETTER_AUTH_SECRET and a running server on
 * TEST_SERVER_URL / BETTER_AUTH_URL (default http://localhost:3001).
 * Skips when no database is configured.
 */

import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

/**
 * Better Auth only enforces its origin check outside `NODE_ENV=test`; the CSRF
 * assertions below are skipped (not weakened) where the vendor check is disabled.
 */
const CSRF_ENFORCED = process.env.NODE_ENV !== 'test';
const SUFFIX = randomUUID().slice(0, 8);
const EMAIL_DOMAIN = `portal-${SUFFIX}@integration.agencyos.invalid`;

/**
 * Better Auth rejects state-changing requests that carry no Origin/Referer
 * (CSRF protection). Integration tests are not a browser, so they say who they
 * are — we never weaken the server's trusted origins for tests.
 */
const ORIGIN_HEADERS = { Origin: SERVER_URL };

type JsonResult = {
  status: number;
  // Response bodies differ per endpoint and every assertion below narrows the
  // shape it needs; typing this as `unknown` would only add casts without adding
  // safety.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
  json: any;
  text: string;
  headers: Headers;
};

async function api(
  token: string | null,
  pathname: string,
  init: { method?: string; body?: unknown; accept?: string } = {}
): Promise<JsonResult> {
  const headers: Record<string, string> = {
    Accept: init.accept ?? 'application/json',
    ...ORIGIN_HEADERS,
  };
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
  });
  return { token, user, organization };
}

describeIfDb('Client Portal integration (real PostgreSQL)', () => {
  // Agencies
  let agencyEmail: string;
  let agencyToken: string;
  let agencyOrgId: string;
  let otherAgencyToken: string;
  let otherAgencyOrgId: string;

  // CRM seed data for agency A
  let contactAId: string;
  let secondContactId: string;
  let projectSharedId: string;
  let projectUnsharedId: string;
  let sharedDocumentId: string;
  let unsharedDocumentId: string;
  let sharedFileId: string;
  let invoiceSharedId: string;

  // CRM seed data for agency B (cross-tenant target)
  let projectOtherTenantId: string;
  let contactOtherTenantId: string;

  // Clients
  let clientEmail: string;
  let clientToken: string;
  let clientAccessId: string;
  let secondClientEmail: string;
  let secondClientToken: string;
  let secondClientAccessId: string;
  let otherTenantClientToken: string;

  async function invitationTokenFor(email: string, contactId: string, role = 'client_approver') {
    const invite = await api(agencyToken, '/api/v1/admin/client-invitations', {
      method: 'POST',
      body: { email, contactId, role },
    });
    expect(invite.status, invite.text).toBe(201);
    return invite.json as { token: string; acceptPath: string; id: string; expiresAt: string };
  }

  const createdOrgIds: string[] = [];
  const emails: string[] = [];
  const storageFiles: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    await fetch(`${SERVER_URL}/api/auth/session`, { headers: { Accept: 'application/json' } });

    // --- agency A
    const agency = await signUpWithOrg(
      `agency-a-${EMAIL_DOMAIN}`,
      'Agency A Admin',
      `Portal Agency A ${SUFFIX}`
    );
    agencyToken = agency.token;
    agencyOrgId = agency.organization.id;
    agencyEmail = agency.user.email;
    createdOrgIds.push(agencyOrgId);
    emails.push(agency.user.email);

    // --- agency B (independent tenant)
    const other = await signUpWithOrg(
      `agency-b-${EMAIL_DOMAIN}`,
      'Agency B Admin',
      `Portal Agency B ${SUFFIX}`
    );
    otherAgencyToken = other.token;
    otherAgencyOrgId = other.organization.id;
    createdOrgIds.push(otherAgencyOrgId);
    emails.push(other.user.email);

    // --- contacts + projects in agency A
    clientEmail = `client-a-${EMAIL_DOMAIN}`;
    const contact = await api(agencyToken, '/api/v1/crm/contacts', {
      method: 'POST',
      body: { firstName: 'Clara', lastName: 'Portal', email: clientEmail },
    });
    expect(contact.status, contact.text).toBe(201);
    contactAId = contact.json.id;

    secondClientEmail = `client-a2-${EMAIL_DOMAIN}`;
    const secondContact = await api(agencyToken, '/api/v1/crm/contacts', {
      method: 'POST',
      body: { firstName: 'Sam', lastName: 'Second', email: secondClientEmail },
    });
    expect(secondContact.status, secondContact.text).toBe(201);
    secondContactId = secondContact.json.id;

    const sharedProject = await api(agencyToken, '/api/v1/crm/projects', {
      method: 'POST',
      body: { name: `Shared Website Build ${SUFFIX}`, clientId: contactAId },
    });
    expect(sharedProject.status, sharedProject.text).toBe(201);
    projectSharedId = sharedProject.json.id;

    const unsharedProject = await api(agencyToken, '/api/v1/crm/projects', {
      method: 'POST',
      body: { name: `Internal Only Project ${SUFFIX}`, clientId: contactAId },
    });
    expect(unsharedProject.status, unsharedProject.text).toBe(201);
    projectUnsharedId = unsharedProject.json.id;

    // --- project file asset for download tests
    const storageRoot = path.resolve(process.env.STORAGE_LOCAL_PATH || './storage/uploads');
    const relativeStoragePath = path.join(agencyOrgId, `portal-${SUFFIX}.txt`);
    const absolutePath = path.join(storageRoot, relativeStoragePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `portal download fixture ${SUFFIX}`);
    storageFiles.push(absolutePath);

    const fileAsset = await prisma.fileAsset.create({
      data: {
        organizationId: agencyOrgId,
        originalName: 'kickoff-notes.txt',
        mimeType: 'text/plain',
        size: 32,
        storagePath: relativeStoragePath,
      },
    });
    const projectFile = await prisma.projectFile.create({
      data: { organizationId: agencyOrgId, projectId: projectSharedId, fileAssetId: fileAsset.id },
    });
    sharedFileId = projectFile.id;

    const document = await prisma.document.create({
      data: {
        organizationId: agencyOrgId,
        title: `Shared Document ${SUFFIX}`,
        type: 'proposal',
        fileAssetId: fileAsset.id,
      },
    });
    sharedDocumentId = document.id;

    const hiddenDocument = await prisma.document.create({
      data: {
        organizationId: agencyOrgId,
        title: `Unshared Document ${SUFFIX}`,
        type: 'proposal',
      },
    });
    unsharedDocumentId = hiddenDocument.id;

    // --- invoice for the portal invoice list
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: agencyOrgId,
        number: `INV-PORTAL-${SUFFIX}`,
        title: 'Design retainer',
        clientId: contactAId,
        status: 'sent',
        subtotal: '1000.00',
        tax: '0.00',
        total: '1000.00',
        currency: 'USD',
      },
    });
    invoiceSharedId = invoice.id;

    // --- cross-tenant fixtures
    const tenantBContact = await api(otherAgencyToken, '/api/v1/crm/contacts', {
      method: 'POST',
      body: { firstName: 'Bob', lastName: 'Other', email: `client-b-${EMAIL_DOMAIN}` },
    });
    expect(tenantBContact.status, tenantBContact.text).toBe(201);
    contactOtherTenantId = tenantBContact.json.id;

    const tenantBProject = await api(otherAgencyToken, '/api/v1/crm/projects', {
      method: 'POST',
      body: { name: `Tenant B Project ${SUFFIX}`, clientId: contactOtherTenantId },
    });
    expect(tenantBProject.status, tenantBProject.text).toBe(201);
    projectOtherTenantId = tenantBProject.json.id;

    // --- client A1 accepts an invitation
    const invitation = await invitationTokenFor(clientEmail, contactAId);
    clientToken = await signUp(clientEmail, 'Clara Portal');
    emails.push(clientEmail);

    const accepted = await api(
      clientToken,
      `/api/v1/portal/invitations/${invitation.token}/accept`,
      {
        method: 'POST',
      }
    );
    expect(accepted.status, accepted.text).toBe(200);
    clientAccessId = accepted.json.clientAccessId;

    // --- client A2 (same organization, different client) accepts its own invitation
    const invitation2 = await invitationTokenFor(
      secondClientEmail,
      secondContactId,
      'client_viewer'
    );
    secondClientToken = await signUp(secondClientEmail, 'Sam Second');
    emails.push(secondClientEmail);

    const accepted2 = await api(
      secondClientToken,
      `/api/v1/portal/invitations/${invitation2.token}/accept`,
      { method: 'POST' }
    );
    expect(accepted2.status, accepted2.text).toBe(200);
    secondClientAccessId = accepted2.json.clientAccessId;

    // --- client of tenant B
    const tenantBInvitation = await (async () => {
      const invite = await api(otherAgencyToken, '/api/v1/admin/client-invitations', {
        method: 'POST',
        body: {
          email: `client-b-${EMAIL_DOMAIN}`,
          contactId: contactOtherTenantId,
          role: 'client_viewer',
        },
      });
      expect(invite.status, invite.text).toBe(201);
      return invite.json;
    })();
    otherTenantClientToken = await signUp(`client-b-${EMAIL_DOMAIN}`, 'Bob Other');
    emails.push(`client-b-${EMAIL_DOMAIN}`);
    const accepted3 = await api(
      otherTenantClientToken,
      `/api/v1/portal/invitations/${tenantBInvitation.token}/accept`,
      { method: 'POST' }
    );
    expect(accepted3.status, accepted3.text).toBe(200);
  }, 180_000);

  afterAll(async () => {
    for (const file of storageFiles) {
      await fs.rm(file, { force: true }).catch(() => undefined);
    }
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

  describe('invitation lifecycle', () => {
    it('stores only the token hash and returns the raw token exactly once', async () => {
      const contact = await api(agencyToken, '/api/v1/crm/contacts', {
        method: 'POST',
        body: { firstName: 'Hash', lastName: 'Check', email: `hash-${EMAIL_DOMAIN}` },
      });
      expect(contact.status, contact.text).toBe(201);

      const invite = await invitationTokenFor(
        `hash-${EMAIL_DOMAIN}`,
        contact.json.id,
        'client_viewer'
      );
      expect(typeof invite.token).toBe('string');
      expect(invite.token.length).toBeGreaterThanOrEqual(40);
      expect(invite.acceptPath).toBe(`/portal/invite/${invite.token}`);

      const row = await prisma.clientInvitation.findFirstOrThrow({
        where: { id: invite.id, organizationId: agencyOrgId },
      });
      expect(row.tokenHash).toBe(createHash('sha256').update(invite.token).digest('hex'));
      expect(row.tokenHash).not.toBe(invite.token);
      expect(JSON.stringify(row)).not.toContain(invite.token);
      expect(row.status).toBe('pending');
    });

    it('with e-mail delivery off, says so instead of claiming an e-mail was sent', async () => {
      // The server under test runs without EMAIL_TRANSPORT (CI and the local
      // default). The response must report that, still hand over the link, and
      // leave no trace of a delivery in the audit trail.
      const email = `no-email-${EMAIL_DOMAIN}`;
      const invite = await api(agencyToken, '/api/v1/admin/client-invitations', {
        method: 'POST',
        body: { email, contactId: await freshContact(email), role: 'client_viewer' },
      });

      expect(invite.status, invite.text).toBe(201);
      expect(invite.json.emailDelivery).toEqual({ status: 'disabled' });
      expect(invite.json.acceptPath).toBe(`/portal/invite/${invite.json.token}`);

      const audit = await prisma.auditLog.findMany({
        where: {
          organizationId: agencyOrgId,
          entityType: 'ClientInvitation',
          entityId: invite.json.id,
        },
        select: { action: true },
      });
      expect(audit.map((entry: { action: string }) => entry.action)).toEqual([
        'client.invitation.create',
      ]);
    });

    it('serves the public invitation view without a session, exposing only invitee-facing fields', async () => {
      const view = await api(null, `/api/v1/portal/invitations/${await liveInvitationToken()}`);

      expect(view.status).toBe(200);
      expect(view.json.email).toBeDefined();
      expect(view.json.organizationName).toContain(`Portal Agency A ${SUFFIX}`);
      expect(view.text).not.toContain('tokenHash');
      expect(view.text).not.toContain(agencyOrgId);
    });

    it('renders the accept button on the invitation page for the invited signed-in account', async () => {
      const email = `signed-in-invite-${EMAIL_DOMAIN}`;
      const invite = await invitationTokenFor(email, await freshContact(email));
      const inviteeToken = await signUp(email, 'Signed In Invitee');
      emails.push(email);

      const pageHtml = await api(inviteeToken, `/portal/invite/${invite.token}`, {
        accept: 'text/html',
      });

      expect(pageHtml.status).toBe(200);
      expect(pageHtml.text).toContain('data-testid="accept-invitation"');
      // The signed-out sign-in form must be gone, otherwise the visitor is stuck.
      expect(pageHtml.text).not.toContain('First time here? Create your password');
    });

    it('rejects acceptance by a signed-in account with a different e-mail (403)', async () => {
      const invite = await invitationTokenFor(
        `mismatch-${EMAIL_DOMAIN}`,
        await freshContact(`mismatch-${EMAIL_DOMAIN}`)
      );
      const otherUserToken = await signUp(`other-user-${EMAIL_DOMAIN}`, 'Other User');
      emails.push(`other-user-${EMAIL_DOMAIN}`);

      const attempt = await api(
        otherUserToken,
        `/api/v1/portal/invitations/${invite.token}/accept`,
        {
          method: 'POST',
        }
      );

      expect(attempt.status).toBe(403);
      const row = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invite.id } });
      expect(row.status).toBe('pending');
    });

    it('rejects an unauthenticated acceptance with 401', async () => {
      const invite = await invitationTokenFor(
        `anon-${EMAIL_DOMAIN}`,
        await freshContact(`anon-${EMAIL_DOMAIN}`)
      );
      const attempt = await api(null, `/api/v1/portal/invitations/${invite.token}/accept`, {
        method: 'POST',
      });
      expect(attempt.status).toBe(401);
    });

    it('rejects a replayed acceptance with 410 and keeps a single portal identity', async () => {
      const email = `replay-${EMAIL_DOMAIN}`;
      const invite = await invitationTokenFor(email, await freshContact(email), 'client_viewer');
      const token = await signUp(email, 'Replay Client');
      emails.push(email);

      const first = await api(token, `/api/v1/portal/invitations/${invite.token}/accept`, {
        method: 'POST',
      });
      expect(first.status, first.text).toBe(200);

      const second = await api(token, `/api/v1/portal/invitations/${invite.token}/accept`, {
        method: 'POST',
      });
      expect(second.status).toBe(410);

      const rows = await prisma.clientAccess.findMany({
        where: { organizationId: agencyOrgId, contact: { email } },
      });
      expect(rows).toHaveLength(1);
    });

    it('answers 410 for an expired invitation', async () => {
      const email = `expired-${EMAIL_DOMAIN}`;
      const invite = await invitationTokenFor(email, await freshContact(email), 'client_viewer');
      await prisma.clientInvitation.update({
        where: { id: invite.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const view = await api(null, `/api/v1/portal/invitations/${invite.token}`);
      expect(view.status).toBe(410);

      const token = await signUp(email, 'Expired Client');
      emails.push(email);
      const accept = await api(token, `/api/v1/portal/invitations/${invite.token}/accept`, {
        method: 'POST',
      });
      expect(accept.status).toBe(410);

      const row = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invite.id } });
      expect(row.status).toBe('expired');
    });

    it('answers 410 for a revoked invitation and blocks acceptance', async () => {
      const email = `revoked-invitation-${EMAIL_DOMAIN}`;
      const invite = await invitationTokenFor(email, await freshContact(email), 'client_viewer');

      const revoke = await api(
        agencyToken,
        `/api/v1/admin/client-invitations/${invite.id}/revoke`,
        {
          method: 'POST',
        }
      );
      expect(revoke.status, revoke.text).toBe(200);

      const accept = await api(
        await signUp(email, 'Revoked Invite Client'),
        `/api/v1/portal/invitations/${invite.token}/accept`,
        { method: 'POST' }
      );
      emails.push(email);
      expect(accept.status).toBe(410);

      expect(
        await prisma.clientAccess.count({
          where: { contact: { email }, organizationId: agencyOrgId },
        })
      ).toBe(0);
    });
  });

  describe('identity and session segregation', () => {
    it('creates a client identity with no organization, no role and userType=client', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: clientEmail } });
      expect(user.userType).toBe('client');
      expect(user.organizationId).toBeNull();

      expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(0);

      const access = await prisma.clientAccess.findUniqueOrThrow({ where: { id: clientAccessId } });
      expect(access.organizationId).toBe(agencyOrgId);
      expect(access.status).toBe('active');
    });

    it('gives an active client a portal session with its capability flags', async () => {
      const session = await api(clientToken, '/api/v1/portal/session');
      expect(session.status, session.text).toBe(200);
      expect(session.json).toMatchObject({
        email: clientEmail,
        organizationName: `Portal Agency A ${SUFFIX}`,
        status: 'active',
        capabilities: {
          canViewInvoices: true,
          canDownloadFiles: true,
          canComment: true,
          canApprove: true,
        },
      });
    });

    it('denies the portal to an internal team member (403)', async () => {
      const session = await api(agencyToken, '/api/v1/portal/session');
      expect(session.status).toBe(403);

      const page = await api(agencyToken, '/portal');
      expect([301, 302, 303, 307, 308]).toContain(page.status);
    });

    it('denies internal APIs to a client (403) and never leaks an internal page', async () => {
      for (const pathname of [
        '/api/v1/crm/contacts',
        '/api/v1/crm/projects',
        '/api/v1/admin/client-access',
        '/api/v1/admin/client-invitations',
        '/api/v1/admin/client-approvals',
      ]) {
        const response = await api(clientToken, pathname);
        expect(response.status, `${pathname} must be forbidden for a client`).toBe(403);
      }

      const dashboard = await api(clientToken, '/admin/client-portal');
      expect([301, 302, 303, 307, 308]).toContain(dashboard.status);
    });

    it('sends an unauthenticated portal visit to the portal login, not the team login', async () => {
      const response = await fetch(`${SERVER_URL}/portal`, { redirect: 'manual' });
      expect([302, 307]).toContain(response.status);
      expect(response.headers.get('location')).toContain('/portal/login');
    });

    it('returns 401 for a portal request without a session', async () => {
      expect((await api(null, '/api/v1/portal/session')).status).toBe(401);
      expect((await api(null, '/api/v1/portal/approvals')).status).toBe(401);
      expect(
        (await api(null, '/api/v1/portal/comments?resourceType=project&resourceId=x')).status
      ).toBe(401);
      expect((await api(null, '/api/v1/portal/download/file/x')).status).toBe(401);
    });

    it('never trusts a client-supplied organization id in a write payload', async () => {
      const response = await api(clientToken, '/api/v1/portal/comments', {
        method: 'POST',
        body: {
          resourceType: 'project',
          resourceId: projectSharedId,
          body: 'smuggled org',
          organizationId: otherAgencyOrgId,
        },
      });
      expect(response.status).toBe(400);
    });
  });

  describe('resource grants and isolation', () => {
    it('answers 404 for an unshared project before the grant exists', async () => {
      const page = await api(clientToken, `/portal/projects/${projectUnsharedId}`);
      expect(page.status).toBe(404);

      const respond = await api(clientToken, `/api/v1/portal/approvals/any`, { method: 'POST' });
      expect([400, 404, 405]).toContain(respond.status);
    });

    it('grants a project and lets the client read exactly that project', async () => {
      const grant = await api(agencyToken, `/api/v1/admin/client-access/${clientAccessId}/grants`, {
        method: 'POST',
        body: {
          resourceType: 'project',
          resourceId: projectSharedId,
          canComment: true,
          canApprove: true,
        },
      });
      expect(grant.status, grant.text).toBe(201);

      const portal = await api(clientToken, '/portal');
      expect(portal.status).toBe(200);
      expect(portal.text).toContain(`Shared Website Build ${SUFFIX}`);
      expect(portal.text).not.toContain(`Internal Only Project ${SUFFIX}`);

      const projectPage = await api(clientToken, `/portal/projects/${projectSharedId}`);
      expect(projectPage.status).toBe(200);
      expect(projectPage.text).toContain(`Shared Website Build ${SUFFIX}`);

      // The unshared sibling stays invisible even though the caller is authorized
      // for the organization.
      expect((await api(clientToken, `/portal/projects/${projectUnsharedId}`)).status).toBe(404);
    });

    it('refuses to grant a resource from another organization', async () => {
      const grant = await api(agencyToken, `/api/v1/admin/client-access/${clientAccessId}/grants`, {
        method: 'POST',
        body: { resourceType: 'project', resourceId: projectOtherTenantId },
      });
      expect([400, 404]).toContain(grant.status);
    });

    it('refuses to grant a resource of another organization to a client of a different tenant', async () => {
      // agency B admin cannot see agency A client accesses at all.
      const list = await api(otherAgencyToken, '/api/v1/admin/client-access');
      expect(list.status).toBe(200);
      expect(list.json.data.some((row: { id: string }) => row.id === clientAccessId)).toBe(false);

      const attempt = await api(
        otherAgencyToken,
        `/api/v1/admin/client-access/${clientAccessId}/grants`,
        {
          method: 'POST',
          body: { resourceType: 'project', resourceId: projectOtherTenantId },
        }
      );
      expect(attempt.status).toBe(404);
    });

    it('denies a second client of the same organization access to the first client grant', async () => {
      const page = await api(secondClientToken, `/portal/projects/${projectSharedId}`);
      expect(page.status).toBe(404);

      const approval = await api(agencyToken, '/api/v1/admin/client-approvals', {
        method: 'POST',
        body: {
          clientAccessId,
          resourceType: 'project',
          resourceId: projectSharedId,
          title: 'Cross client probe',
        },
      });
      expect(approval.status, approval.text).toBe(201);

      const respond = await api(
        secondClientToken,
        `/api/v1/portal/approvals/${approval.json.id}/respond`,
        { method: 'POST', body: { decision: 'approved' } }
      );
      // A viewer lacks the approve capability, so the capability gate answers 403
      // before any approval lookup — the id is never probed.
      expect([403, 404]).toContain(respond.status);

      await api(agencyToken, `/api/v1/admin/client-approvals/${approval.json.id}/cancel`, {
        method: 'POST',
      });
    });

    it('keeps a client from another tenant out of this tenant portal entirely', async () => {
      const session = await api(otherTenantClientToken, '/api/v1/portal/session');
      expect(session.status).toBe(200);
      expect(session.json.organizationName).toContain(`Portal Agency B ${SUFFIX}`);

      const page = await api(otherTenantClientToken, `/portal/projects/${projectSharedId}`);
      expect(page.status).toBe(404);

      const dashboard = await api(otherTenantClientToken, '/portal');
      expect(dashboard.status).toBe(200);
      expect(dashboard.text).not.toContain(`Shared Website Build ${SUFFIX}`);
    });
  });

  describe('approvals', () => {
    let approvalId: string;

    it('creates an approval request with a "requested" history event', async () => {
      const created = await api(agencyToken, '/api/v1/admin/client-approvals', {
        method: 'POST',
        body: {
          clientAccessId,
          resourceType: 'project',
          resourceId: projectSharedId,
          title: 'Approve homepage design',
          description: 'Please review the hero section.',
        },
      });
      expect(created.status, created.text).toBe(201);
      approvalId = created.json.id;

      const events = await prisma.clientApprovalEvent.findMany({
        where: { approvalId },
        orderBy: { createdAt: 'asc' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'requested', actorType: 'internal' });
    });

    it('shows the pending approval to the addressed client only', async () => {
      const list = await api(clientToken, '/api/v1/portal/approvals');
      expect(list.status, list.text).toBe(200);
      expect(list.json.data.map((row: { id: string }) => row.id)).toContain(approvalId);

      const otherClientList = await api(secondClientToken, '/api/v1/portal/approvals');
      expect(otherClientList.status).toBe(200);
      expect(otherClientList.json.data).toHaveLength(0);

      const detail = await api(clientToken, `/api/v1/portal/approvals/${approvalId}`);
      expect(detail.status).toBe(200);
      expect(detail.json.approval).toMatchObject({ id: approvalId, status: 'pending' });
      expect(detail.json.approval).not.toHaveProperty('organizationId');
    });

    it('records the decision with the client identity and timestamp from the session', async () => {
      const responded = await api(clientToken, `/api/v1/portal/approvals/${approvalId}/respond`, {
        method: 'POST',
        body: { decision: 'approved', note: 'Looks great, go ahead.' },
      });
      expect(responded.status, responded.text).toBe(200);

      const clientUser = await prisma.user.findUniqueOrThrow({ where: { email: clientEmail } });
      const row = await prisma.clientApproval.findUniqueOrThrow({ where: { id: approvalId } });
      expect(row.status).toBe('approved');
      expect(row.respondedBy).toBe(clientUser.id);
      expect(row.respondedAt).not.toBeNull();
      expect(row.responseNote).toBe('Looks great, go ahead.');

      const events = await prisma.clientApprovalEvent.findMany({
        where: { approvalId },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((event: { action: string }) => event.action)).toEqual([
        'requested',
        'approved',
      ]);
      expect(events[1]).toMatchObject({ actorType: 'client', actorUserId: clientUser.id });
    });

    it('treats the decision as terminal (409 on a second response)', async () => {
      const second = await api(clientToken, `/api/v1/portal/approvals/${approvalId}/respond`, {
        method: 'POST',
        body: { decision: 'changes_requested', note: 'Actually, change it.' },
      });
      expect(second.status).toBe(409);

      const row = await prisma.clientApproval.findUniqueOrThrow({ where: { id: approvalId } });
      expect(row.status).toBe('approved');
      expect(await prisma.clientApprovalEvent.count({ where: { approvalId } })).toBe(2);
    });

    it('refuses a decision on an approval of another client (404)', async () => {
      const created = await api(agencyToken, '/api/v1/admin/client-approvals', {
        method: 'POST',
        body: {
          clientAccessId,
          resourceType: 'project',
          resourceId: projectSharedId,
          title: 'Second approval',
        },
      });
      expect(created.status, created.text).toBe(201);

      const denied = await api(
        secondClientToken,
        `/api/v1/portal/approvals/${created.json.id}/respond`,
        {
          method: 'POST',
          body: { decision: 'approved' },
        }
      );
      // Either the capability gate (403) or the per-approval lookup (404) stops it;
      // never a 2xx, and never a distinction between "not yours" and "no such id".
      expect([403, 404]).toContain(denied.status);

      await api(agencyToken, `/api/v1/admin/client-approvals/${created.json.id}/cancel`, {
        method: 'POST',
      });
    });

    it('refuses to request an approval on an unshared resource', async () => {
      const created = await api(agencyToken, '/api/v1/admin/client-approvals', {
        method: 'POST',
        body: {
          clientAccessId,
          resourceType: 'project',
          resourceId: projectUnsharedId,
          title: 'Not shared',
        },
      });
      expect(created.status).toBe(400);
    });
  });

  describe('comments and feedback', () => {
    it('records a client comment as client-visible and surfaces it to the team', async () => {
      const created = await api(clientToken, '/api/v1/portal/comments', {
        method: 'POST',
        body: {
          resourceType: 'project',
          resourceId: projectSharedId,
          body: 'Excited to get started!',
        },
      });
      expect(created.status, created.text).toBe(201);
      expect(created.json.visibility ?? 'client').toBe('client');

      const internal = await api(
        agencyToken,
        `/api/v1/admin/client-comments?resourceType=project&resourceId=${projectSharedId}`
      );
      expect(internal.status, internal.text).toBe(200);
      const bodies = internal.json.data.map((row: { body: string }) => row.body);
      expect(bodies).toContain('Excited to get started!');
    });

    it('keeps an internal-only note invisible to the client', async () => {
      const note = await api(agencyToken, '/api/v1/admin/client-comments', {
        method: 'POST',
        body: {
          resourceType: 'project',
          resourceId: projectSharedId,
          body: 'Internal: this client is price sensitive',
          visibility: 'internal',
        },
      });
      expect(note.status, note.text).toBe(201);

      const clientView = await api(
        clientToken,
        `/api/v1/portal/comments?resourceType=project&resourceId=${projectSharedId}`
      );
      expect(clientView.status).toBe(200);
      const clientBodies = clientView.json.data.map((row: { body: string }) => row.body);
      expect(clientBodies).toContain('Excited to get started!');
      expect(clientBodies).not.toContain('Internal: this client is price sensitive');

      // The project page renders the client-visible conversation…
      const page = await api(clientToken, `/portal/projects/${projectSharedId}`);
      expect(page.status).toBe(200);
      expect(page.text).toContain('Excited to get started!');
      // …and the internal note stays invisible on the rendered page too.
      expect(page.text).not.toContain('price sensitive');

      // The team still sees it in their own inbox view.
      const internalView = await api(
        agencyToken,
        `/api/v1/admin/client-comments?resourceType=project&resourceId=${projectSharedId}`
      );
      expect(internalView.json.data.map((row: { body: string }) => row.body)).toContain(
        'Internal: this client is price sensitive'
      );
    });

    it('refuses a client comment that smuggles internal visibility', async () => {
      const response = await api(clientToken, '/api/v1/portal/comments', {
        method: 'POST',
        body: {
          resourceType: 'project',
          resourceId: projectSharedId,
          body: 'Trying to hide this',
          visibility: 'internal',
        },
      });
      // The service forces `client`, so the comment is stored client-visible.
      expect(response.status).toBe(201);
      const stored = await prisma.clientComment.findFirstOrThrow({
        where: { body: 'Trying to hide this', organizationId: agencyOrgId },
      });
      expect(stored.visibility).toBe('client');
      expect(stored.authorType).toBe('client');
    });

    it('refuses a client comment on an unshared project (404)', async () => {
      const response = await api(clientToken, '/api/v1/portal/comments', {
        method: 'POST',
        body: { resourceType: 'project', resourceId: projectUnsharedId, body: 'Should not stick' },
      });
      expect(response.status).toBe(404);
    });
  });

  describe('documents, invoices and downloads', () => {
    it('requires a grant to see a document', async () => {
      const unshared = await api(clientToken, `/portal/documents`);
      expect(unshared.status).toBe(200);
      expect(unshared.text).not.toContain(`Shared Document ${SUFFIX}`);
      expect(unshared.text).not.toContain(`Unshared Document ${SUFFIX}`);

      const shared = await api(
        agencyToken,
        `/api/v1/admin/client-access/${clientAccessId}/grants`,
        {
          method: 'POST',
          body: { resourceType: 'document', resourceId: sharedDocumentId },
        }
      );
      expect(shared.status, shared.text).toBe(201);

      const documents = await api(clientToken, '/portal/documents');
      expect(documents.status).toBe(200);
      expect(documents.text).toContain(`Shared Document ${SUFFIX}`);
      expect(documents.text).not.toContain(`Unshared Document ${SUFFIX}`);
    });

    it('denies an unauthorized document download (404) and serves an authorized one', async () => {
      const denied = await api(
        clientToken,
        `/api/v1/portal/download/document/${unsharedDocumentId}`
      );
      expect(denied.status).toBe(404);

      const granted = await api(
        clientToken,
        `/api/v1/portal/download/document/${sharedDocumentId}`
      );
      expect(granted.status, granted.text).toBe(200);
      expect(granted.headers.get('content-disposition')).toContain('attachment');
      expect(granted.headers.get('x-content-type-options')).toBe('nosniff');
      expect(granted.text).toBe(`portal download fixture ${SUFFIX}`);
    });

    it('serves a granted project file with the same guards', async () => {
      const grant = await api(agencyToken, `/api/v1/admin/client-access/${clientAccessId}/grants`, {
        method: 'POST',
        body: { resourceType: 'file', resourceId: sharedFileId },
      });
      expect(grant.status, grant.text).toBe(201);

      const download = await api(clientToken, `/api/v1/portal/download/file/${sharedFileId}`);
      expect(download.status, download.text).toBe(200);
      expect(download.text).toBe(`portal download fixture ${SUFFIX}`);
    });

    it('refuses a download type that is not file or document', async () => {
      const response = await api(clientToken, `/api/v1/portal/download/project/${projectSharedId}`);
      expect(response.status).toBe(404);
    });

    it('revoking a single grant immediately removes access to that resource', async () => {
      const grants = await api(agencyToken, `/api/v1/admin/client-access/${clientAccessId}/grants`);
      expect(grants.status).toBe(200);
      const documentGrant = grants.json.data.find(
        (grant: { resourceType: string; resourceId: string }) =>
          grant.resourceType === 'document' && grant.resourceId === sharedDocumentId
      );
      expect(documentGrant).toBeDefined();

      const revoked = await api(
        agencyToken,
        `/api/v1/admin/client-access/${clientAccessId}/grants/${documentGrant.id}`,
        { method: 'DELETE' }
      );
      expect(revoked.status, revoked.text).toBe(200);

      const download = await api(
        clientToken,
        `/api/v1/portal/download/document/${sharedDocumentId}`
      );
      expect(download.status).toBe(404);

      const documents = await api(clientToken, '/portal/documents');
      expect(documents.text).not.toContain(`Shared Document ${SUFFIX}`);
    });

    it('shows invoices only after an invoice grant and never exposes payment ability', async () => {
      const before = await api(clientToken, '/portal/invoices');
      expect(before.status).toBe(200);
      expect(before.text).not.toContain(`INV-PORTAL-${SUFFIX}`);

      const grant = await api(agencyToken, `/api/v1/admin/client-access/${clientAccessId}/grants`, {
        method: 'POST',
        body: { resourceType: 'invoice', resourceId: invoiceSharedId },
      });
      expect(grant.status, grant.text).toBe(201);

      const after = await api(clientToken, '/portal/invoices');
      expect(after.status).toBe(200);
      expect(after.text).toContain(`INV-PORTAL-${SUFFIX}`);
      expect(after.text.toLowerCase()).toContain('online payment is not enabled');
    });
  });

  describe('suspension and revocation', () => {
    it('suspending an identity kills its sessions and blanks the portal', async () => {
      const suspended = await api(
        agencyToken,
        `/api/v1/admin/client-access/${secondClientAccessId}`,
        {
          method: 'PATCH',
          body: { status: 'suspended' },
        }
      );
      expect(suspended.status, suspended.text).toBe(200);

      const session = await api(secondClientToken, '/api/v1/portal/session');
      expect(session.status).toBe(401);

      const page = await api(secondClientToken, '/portal');
      expect([302, 307]).toContain(page.status);

      const signIn = await api(null, '/api/auth/sign-in/email', {
        method: 'POST',
        body: { email: secondClientEmail, password: TEST_PASSWORD },
      });
      expect([401, 403]).toContain(signIn.status);
    });

    it('revocation closes grants, cancels pending approvals, disables the account and audits it', async () => {
      const pending = await api(agencyToken, '/api/v1/admin/client-approvals', {
        method: 'POST',
        body: {
          clientAccessId,
          resourceType: 'project',
          resourceId: projectSharedId,
          title: 'Approval open at revocation',
        },
      });
      expect(pending.status, pending.text).toBe(201);

      const revoked = await api(
        agencyToken,
        `/api/v1/admin/client-access/${clientAccessId}/revoke`,
        {
          method: 'POST',
          body: { reason: 'Engagement ended' },
        }
      );
      expect(revoked.status, revoked.text).toBe(200);

      const access = await prisma.clientAccess.findUniqueOrThrow({ where: { id: clientAccessId } });
      expect(access.status).toBe('revoked');

      expect(
        await prisma.clientResourceGrant.count({
          where: { clientAccessId, revokedAt: null },
        })
      ).toBe(0);

      const cancelled = await prisma.clientApproval.findUniqueOrThrow({
        where: { id: pending.json.id },
      });
      expect(cancelled.status).toBe('cancelled');

      const user = await prisma.user.findUniqueOrThrow({ where: { email: clientEmail } });
      expect(user.status).toBe('disabled');
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

      const audit = await prisma.auditLog.findFirst({
        where: { organizationId: agencyOrgId, action: 'client.access.revoke' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
    });

    it('a revoked client cannot use an existing session, sign in, or read anything', async () => {
      expect((await api(clientToken, '/api/v1/portal/session')).status).toBe(401);
      expect((await api(clientToken, '/portal')).status).toBe(307);
      expect((await api(clientToken, '/api/v1/portal/approvals')).status).toBe(401);

      const download = await api(clientToken, `/api/v1/portal/download/file/${sharedFileId}`);
      expect(download.status).toBe(401);

      const signIn = await api(null, '/api/auth/sign-in/email', {
        method: 'POST',
        body: { email: clientEmail, password: TEST_PASSWORD },
      });
      expect([401, 403]).toContain(signIn.status);
    });

    it('refuses to re-grant or re-activate a revoked identity', async () => {
      const grant = await api(agencyToken, `/api/v1/admin/client-access/${clientAccessId}/grants`, {
        method: 'POST',
        body: { resourceType: 'project', resourceId: projectSharedId },
      });
      expect(grant.status).toBe(400);

      const reactivate = await api(agencyToken, `/api/v1/admin/client-access/${clientAccessId}`, {
        method: 'PATCH',
        body: { status: 'active' },
      });
      expect(reactivate.status).toBe(400);
    });
  });

  describe('CSRF and error hygiene', () => {
    it('signs a team account in from a trusted origin', async () => {
      // Positive control for the CSRF story: the same credentials that the next
      // test sends without a trusted origin are accepted when the origin is trusted.
      const response = await api(null, '/api/auth/sign-in/email', {
        method: 'POST',
        body: { email: agencyEmail, password: TEST_PASSWORD },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toContain('better-auth.session_token');
    });

    // Better Auth turns its origin/CSRF check off when NODE_ENV=test (which is how
    // the CI integration job runs the production server), so the enforcement half
    // only runs where the check is active — including a normal `next start` in
    // production. It is skipped, never silently passed, when that check is off.
    it.skipIf(!CSRF_ENFORCED)(
      'refuses a state-changing sign-in that carries no trusted origin',
      async () => {
        const credentials = { email: agencyEmail, password: TEST_PASSWORD };

        const withoutOrigin = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        });
        expect(withoutOrigin.status).toBe(403);

        const foreignOrigin = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
          body: JSON.stringify(credentials),
        });
        expect(foreignOrigin.status).toBe(403);
      }
    );

    it('never returns a stack trace or a Prisma message on a denied request', async () => {
      const denied = await api(clientToken, '/api/v1/portal/download/document/does_not_exist');
      expect([401, 404]).toContain(denied.status);
      expect(denied.text).not.toContain('prisma');
      expect(denied.text).not.toContain(' at ');

      const forbidden = await api(secondClientToken, '/api/v1/crm/projects');
      expect(forbidden.status).toBe(401);
      expect(forbidden.text).not.toContain('prisma');
    });
  });

  // ---------------------------------------------------------------- helpers
  async function freshContact(email: string): Promise<string> {
    const created = await api(agencyToken, '/api/v1/crm/contacts', {
      method: 'POST',
      body: { firstName: 'Auto', lastName: 'Contact', email },
    });
    expect(created.status, created.text).toBe(201);
    return created.json.id;
  }

  /** Create a throwaway invitation and return its token (used for read-only checks). */
  async function liveInvitationToken(): Promise<string> {
    const email = `view-${randomUUID().slice(0, 8)}-${EMAIL_DOMAIN}`;
    const invite = await invitationTokenFor(email, await freshContact(email), 'client_viewer');
    return invite.token;
  }
});
