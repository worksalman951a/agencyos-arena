/**
 * Integration: administration — members, roles, privileges, invitations,
 * audit logging and cross-organization isolation.
 *
 * Accounts are provisioned through `batch4-provisioning`; every assertion drives
 * the real HTTP API with a real signed session cookie.
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import {
  authHeaders,
  cleanupOrganizations,
  createBootstrappedAccount,
  createMemberWithPermissions,
  createOrganizationWithAdmin,
  type TestAccount,
} from './batch4-provisioning';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const createdOrganizations: string[] = [];

async function jsonFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${process.env.TEST_SERVER_URL ?? 'http://localhost:3001'}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function seedInvitation(organizationId: string, email: string, roleId: string) {
  const token = randomBytes(32).toString('base64url');
  const invitation = await prisma.invitation.create({
    data: {
      organizationId,
      email,
      roleId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  return { invitation, token };
}

describeIfDb('administration and RBAC (integration)', () => {
  let admin: TestAccount;

  beforeAll(async () => {
    admin = await createBootstrappedAccount('admin-suite');
    createdOrganizations.push(admin.organizationId);
  });

  afterAll(async () => {
    await cleanupOrganizations(createdOrganizations);
  });

  describe('member listing and updates', () => {
    it('lists members with their roles', async () => {
      const res = await jsonFetch('/api/v1/admin/users', { headers: authHeaders(admin.token) });
      expect(res.status).toBe(200);
      const rows = res.body as Array<{ id: string; roles: string[]; email: string }>;
      const self = rows.find((row) => row.id === admin.userId);
      expect(self).toBeTruthy();
      expect(self!.roles).toContain('Administrator');
      // Never leak password hashes or MFA secrets through the admin API.
      expect(JSON.stringify(rows)).not.toMatch(/password|mfaSecret/);
    });

    it('changes a member role and records an audit entry', async () => {
      const member = await createMemberWithPermissions(admin.organizationId, 'promote', [
        'project.read',
      ]);
      createdOrganizations.push(member.organizationId);

      const adminRole = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, name: 'Administrator' },
      });

      const res = await jsonFetch(`/api/v1/admin/users/${member.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ roleId: adminRole.id }),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((res.body as { roles: string[] }).roles).toContain('Administrator');

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: admin.organizationId,
          action: 'user.role_changed',
          entityId: member.userId,
        },
      });
      expect(audit).toBeTruthy();
    });

    it('rejects a role id from another organization (no escalation by id guessing)', async () => {
      const other = await createOrganizationWithAdmin('role-confusion');
      createdOrganizations.push(other.organizationId);
      const foreignRole = await prisma.role.findFirstOrThrow({
        where: { organizationId: other.organizationId },
      });

      const member = await createMemberWithPermissions(admin.organizationId, 'confusion', [
        'project.read',
      ]);
      createdOrganizations.push(member.organizationId);

      const res = await jsonFetch(`/api/v1/admin/users/${member.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ roleId: foreignRole.id }),
      });
      expect(res.status).toBe(404);
    });

    it('refuses to let an administrator demote themselves', async () => {
      const employeeRole = await prisma.role.create({
        data: { organizationId: admin.organizationId, name: `Employee ${Date.now()}` },
      });
      const res = await jsonFetch(`/api/v1/admin/users/${admin.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ roleId: employeeRole.id }),
      });
      expect(res.status).toBe(400);
    });

    it('keeps at least one active administrator', async () => {
      // Promote a second admin so we can try to remove the last one.
      const second = await createMemberWithPermissions(admin.organizationId, 'second-admin', []);
      createdOrganizations.push(second.organizationId);
      const adminRole = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, name: 'Administrator' },
      });
      await prisma.userRole.updateMany({
        where: { userId: second.userId, organizationId: admin.organizationId },
        data: { roleId: adminRole.id },
      });

      // Demote the second admin: allowed (admin stays active).
      const employeeRole = await prisma.role.create({
        data: { organizationId: admin.organizationId, name: `Employee2 ${Date.now()}` },
      });
      const demote = await jsonFetch(`/api/v1/admin/users/${second.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ roleId: employeeRole.id }),
      });
      expect(demote.status).toBe(200);

      // Marking the only remaining administrator as suspended is refused.
      const suspendSelf = await jsonFetch(`/api/v1/admin/users/${admin.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ status: 'suspended' }),
      });
      expect(suspendSelf.status).toBe(400);
    });

    it('updates supported member profile fields and audits the change', async () => {
      const member = await createMemberWithPermissions(admin.organizationId, 'profile-edit', [
        'project.read',
      ]);
      createdOrganizations.push(member.organizationId);
      const response = await jsonFetch(`/api/v1/admin/users/${member.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({
          displayName: 'Updated teammate',
          avatarUrl: 'https://example.test/avatar.png',
        }),
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({
        name: 'Updated teammate',
        image: 'https://example.test/avatar.png',
      });
      expect(
        await prisma.auditLog.findFirst({
          where: {
            organizationId: admin.organizationId,
            action: 'user.profile_changed',
            entityId: member.userId,
          },
        })
      ).toBeTruthy();
    });

    it('suspends through the admin workflow, revokes sessions, and reactivation requires fresh sign-in', async () => {
      const member = await createMemberWithPermissions(
        admin.organizationId,
        'suspend-through-admin',
        ['project.read']
      );
      createdOrganizations.push(member.organizationId);
      expect(await prisma.session.count({ where: { userId: member.userId } })).toBeGreaterThan(0);

      const suspended = await jsonFetch(`/api/v1/admin/users/${member.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ status: 'suspended' }),
      });
      expect(suspended.status).toBe(200);
      expect(await prisma.session.count({ where: { userId: member.userId } })).toBe(0);
      expect(
        (await jsonFetch('/api/v1/admin/users', { headers: authHeaders(member.token) })).status
      ).not.toBe(200);

      const reactivated = await jsonFetch(`/api/v1/admin/users/${member.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ status: 'active' }),
      });
      expect(reactivated.status).toBe(200);
      expect(await prisma.session.count({ where: { userId: member.userId } })).toBe(0);
    });

    it('blocks a custom user manager from assigning a more privileged role', async () => {
      const manager = await createMemberWithPermissions(
        admin.organizationId,
        'limited-user-manager',
        ['user.update']
      );
      const target = await createMemberWithPermissions(admin.organizationId, 'role-target', [
        'project.read',
      ]);
      createdOrganizations.push(manager.organizationId, target.organizationId);
      const adminRole = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true, name: 'Administrator' },
      });

      const response = await jsonFetch(`/api/v1/admin/users/${target.userId}`, {
        method: 'PATCH',
        headers: authHeaders(manager.token),
        body: JSON.stringify({ roleId: adminRole.id }),
      });
      expect(response.status).toBe(403);
      expect(
        await prisma.userRole.count({
          where: {
            userId: target.userId,
            organizationId: admin.organizationId,
            roleId: adminRole.id,
          },
        })
      ).toBe(0);
    });

    it('does not suspend the last active administrator even when an authorized manager targets them', async () => {
      const manager = await createMemberWithPermissions(admin.organizationId, 'status-manager', [
        'user.update',
      ]);
      createdOrganizations.push(manager.organizationId);

      const response = await jsonFetch(`/api/v1/admin/users/${admin.userId}`, {
        method: 'PATCH',
        headers: authHeaders(manager.token),
        body: JSON.stringify({ status: 'suspended' }),
      });
      expect(response.status).toBe(400);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } })).status).toBe(
        'active'
      );
    });

    it('protects the last administrator from member removal as well as suspension', async () => {
      const manager = await createMemberWithPermissions(admin.organizationId, 'remove-manager', [
        'user.delete',
      ]);
      createdOrganizations.push(manager.organizationId);
      const response = await jsonFetch(`/api/v1/admin/users/${admin.userId}`, {
        method: 'DELETE',
        headers: authHeaders(manager.token),
      });
      expect(response.status).toBe(400);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } })).organizationId
      ).toBe(admin.organizationId);
    });

    it('serializes concurrent administrator suspensions so one active administrator remains', async () => {
      const second = await createMemberWithPermissions(
        admin.organizationId,
        'concurrent-admin',
        []
      );
      createdOrganizations.push(second.organizationId);
      const adminRole = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true, name: 'Administrator' },
      });
      await prisma.userRole.updateMany({
        where: { userId: second.userId, organizationId: admin.organizationId },
        data: { roleId: adminRole.id },
      });

      const responses = await Promise.all([
        jsonFetch(`/api/v1/admin/users/${second.userId}`, {
          method: 'PATCH',
          headers: authHeaders(admin.token),
          body: JSON.stringify({ status: 'suspended' }),
        }),
        jsonFetch(`/api/v1/admin/users/${admin.userId}`, {
          method: 'PATCH',
          headers: authHeaders(second.token),
          body: JSON.stringify({ status: 'suspended' }),
        }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
      const remaining = await prisma.userRole.count({
        where: {
          organizationId: admin.organizationId,
          role: { isSystem: true, name: 'Administrator' },
          user: { status: 'active' },
        },
      });
      expect(remaining).toBe(1);
    });

    it('validates the update payload', async () => {
      const member = await createMemberWithPermissions(admin.organizationId, 'validation', [
        'project.read',
      ]);
      createdOrganizations.push(member.organizationId);

      const res = await jsonFetch(`/api/v1/admin/users/${member.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ status: 'not-a-status' }),
      });
      expect(res.status).toBe(400);
    });

    it('removes a member without deleting their login', async () => {
      const member = await createMemberWithPermissions(admin.organizationId, 'removable', [
        'project.read',
      ]);
      createdOrganizations.push(member.organizationId);

      const res = await jsonFetch(`/api/v1/admin/users/${member.userId}`, {
        method: 'DELETE',
        headers: authHeaders(admin.token),
      });
      expect(res.status).toBe(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: member.userId } });
      expect(user.organizationId).toBeNull();
      expect(await prisma.userRole.count({ where: { userId: member.userId } })).toBe(0);

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: admin.organizationId,
          action: 'user.remove',
          entityId: member.userId,
        },
      });
      expect(audit).toBeTruthy();
    });
  });

  describe('roles and permission enforcement', () => {
    it('creates a custom role and grants only permissions the actor holds', async () => {
      const create = await jsonFetch('/api/v1/admin/roles', {
        method: 'POST',
        headers: authHeaders(admin.token),
        body: JSON.stringify({
          name: `Custom ${Date.now()}`,
          description: 'Read-only projects',
          permissionCodes: ['project.read'],
        }),
      });
      expect(create.status, JSON.stringify(create.body)).toBe(201);
      expect((create.body as { permissions: Array<{ code: string }> }).permissions).toEqual([
        expect.objectContaining({ code: 'project.read' }),
      ]);
    });

    it('refuses to grant a permission the actor does not hold', async () => {
      // A "role manager" that may edit roles but holds no privileged code cannot
      // hand out `user.update` — the escalation path that used to exist.
      const roleManager = await createMemberWithPermissions(admin.organizationId, 'role-manager', [
        'role.read',
        'role.update',
      ]);
      createdOrganizations.push(roleManager.organizationId);

      const target = await prisma.role.create({
        data: { organizationId: admin.organizationId, name: `Escalate ${Date.now()}` },
      });

      const res = await jsonFetch(`/api/v1/admin/roles/${target.id}`, {
        method: 'PATCH',
        headers: authHeaders(roleManager.token),
        body: JSON.stringify({ permissionCodes: ['user.update'] }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects unknown permission codes instead of creating them', async () => {
      const target = await prisma.role.create({
        data: { organizationId: admin.organizationId, name: `Unknown ${Date.now()}` },
      });
      const res = await jsonFetch(`/api/v1/admin/roles/${target.id}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ permissionCodes: ['made.up.permission'] }),
      });
      expect(res.status).toBe(400);
      expect(await prisma.permission.count({ where: { code: 'made.up.permission' } })).toBe(0);
    });

    it('protects system roles from modification', async () => {
      const systemRole = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true },
      });
      const res = await jsonFetch(`/api/v1/admin/roles/${systemRole.id}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ name: 'Renamed' }),
      });
      expect(res.status).toBe(400);
    });

    it('enforces permissions on the API for a member without them', async () => {
      const member = await createMemberWithPermissions(admin.organizationId, 'no-admin', [
        'project.read',
      ]);
      createdOrganizations.push(member.organizationId);

      for (const [path, method] of [
        ['/api/v1/admin/users', 'GET'],
        ['/api/v1/admin/roles', 'GET'],
        ['/api/v1/admin/audit-logs', 'GET'],
        ['/api/v1/admin/invitations', 'GET'],
      ] as const) {
        const res = await jsonFetch(path, { method, headers: authHeaders(member.token) });
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    });
  });

  describe('invitations', () => {
    it('creates an email-only invitation and accepts a verified invitee once', async () => {
      const invitedEmail = `invitee-${Date.now()}@integration.invalid`;
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true, name: 'Administrator' },
      });

      const created = await jsonFetch('/api/v1/admin/invitations', {
        method: 'POST',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ email: invitedEmail, roleId: role.id }),
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const response = created.body as { id: string; emailDelivery: { status: string } };
      expect(response.emailDelivery.status).toBe('disabled');
      expect(created.body).not.toHaveProperty('token');
      expect(created.body).not.toHaveProperty('acceptPath');

      // The raw token is never returned or persisted; only an email-addressed
      // token can activate the pending membership.
      const stored = await prisma.invitation.findUniqueOrThrow({ where: { id: response.id } });
      expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      await prisma.invitation.update({ where: { id: stored.id }, data: { status: 'revoked' } });

      const { invitation, token } = await seedInvitation(
        admin.organizationId,
        invitedEmail,
        role.id
      );
      const preview = await jsonFetch(`/api/v1/invitations/${token}`);
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ organizationName: expect.any(String) });
      expect(JSON.stringify(preview.body)).not.toMatch(/tokenHash|invitedBy/);

      const invitee = await prisma.user.create({
        data: {
          email: invitedEmail,
          name: 'Invitee',
          status: 'active',
          emailVerified: true,
        },
      });
      const { sessionFor } = await import('./batch4-provisioning');
      const inviteeToken = await sessionFor(invitee.id);

      const accept = await jsonFetch('/api/v1/invitations/accept', {
        method: 'POST',
        headers: authHeaders(inviteeToken),
        body: JSON.stringify({ token }),
      });
      expect(accept.status, JSON.stringify(accept.body)).toBe(200);

      const joined = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } });
      expect(joined.organizationId).toBe(admin.organizationId);
      expect(
        await prisma.userRole.count({
          where: { userId: invitee.id, organizationId: admin.organizationId },
        })
      ).toBe(1);

      const second = await jsonFetch('/api/v1/invitations/accept', {
        method: 'POST',
        headers: authHeaders(inviteeToken),
        body: JSON.stringify({ token }),
      });
      expect(second.status).toBe(410);
      expect(
        (await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status
      ).toBe('accepted');
    });

    it('refuses acceptance by a different e-mail address', async () => {
      const invitedEmail = `intended-${Date.now()}@integration.invalid`;
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true },
      });
      const { token } = await seedInvitation(admin.organizationId, invitedEmail, role.id);

      const stranger = await createOrganizationWithAdmin('stranger');
      createdOrganizations.push(stranger.organizationId);
      // Detach so the "already belongs to an organization" rule is not the
      // reason for the rejection.
      await prisma.userRole.deleteMany({ where: { userId: stranger.userId } });
      await prisma.user.update({ where: { id: stranger.userId }, data: { organizationId: null } });
      const token2 = (await import('./batch4-provisioning')).sessionFor(stranger.userId);
      const strangerToken = await token2;

      const res = await jsonFetch('/api/v1/invitations/accept', {
        method: 'POST',
        headers: authHeaders(strangerToken),
        body: JSON.stringify({ token }),
      });
      expect(res.status).toBe(403);
    });

    it('requires verified ownership of the invitee e-mail before activation', async () => {
      const invitedEmail = `unverified-${Date.now()}@integration.invalid`;
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true },
      });
      const { token } = await seedInvitation(admin.organizationId, invitedEmail, role.id);
      const invitee = await prisma.user.create({
        data: { email: invitedEmail, name: 'Unverified', status: 'active', emailVerified: false },
      });
      const { sessionFor } = await import('./batch4-provisioning');
      const inviteeToken = await sessionFor(invitee.id);
      const response = await jsonFetch('/api/v1/invitations/accept', {
        method: 'POST',
        headers: authHeaders(inviteeToken),
        body: JSON.stringify({ token }),
      });
      expect(response.status).toBe(403);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } })).organizationId
      ).toBe(null);
    });

    it('rejects an expired invitation and reports its status', async () => {
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true },
      });
      const { invitation, token } = await seedInvitation(
        admin.organizationId,
        `expired-${Date.now()}@integration.invalid`,
        role.id
      );
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const preview = await jsonFetch(`/api/v1/invitations/${token}`);
      expect(preview.status).toBe(410);
      const listed = await jsonFetch('/api/v1/admin/invitations', {
        headers: authHeaders(admin.token),
      });
      expect(
        (listed.body as Array<{ id: string; status: string }>).find(
          (item) => item.id === invitation.id
        )?.status
      ).toBe('expired');
    });

    it('revokes a pending invitation and invalidates its token', async () => {
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true },
      });
      const { invitation, token } = await seedInvitation(
        admin.organizationId,
        `revoke-${Date.now()}@integration.invalid`,
        role.id
      );
      const revoked = await jsonFetch(`/api/v1/admin/invitations/${invitation.id}`, {
        method: 'DELETE',
        headers: authHeaders(admin.token),
      });
      expect(revoked.status).toBe(200);
      expect(
        (await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status
      ).toBe('revoked');

      const preview = await jsonFetch(`/api/v1/invitations/${token}`);
      expect(preview.status).toBe(410);
    });

    it('resends by rotating the token and revoking the old invitation', async () => {
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true },
      });
      const { invitation, token } = await seedInvitation(
        admin.organizationId,
        `resend-${Date.now()}@integration.invalid`,
        role.id
      );
      const response = await jsonFetch(`/api/v1/admin/invitations/${invitation.id}/resend`, {
        method: 'POST',
        headers: authHeaders(admin.token),
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).not.toHaveProperty('token');
      expect(response.body).not.toHaveProperty('acceptPath');
      expect(response.body).toMatchObject({ emailDelivery: { status: 'disabled' } });
      expect(
        (await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status
      ).toBe('revoked');
      const replacement = response.body as { id: string };
      expect(
        (await prisma.invitation.findUniqueOrThrow({ where: { id: replacement.id } })).status
      ).toBe('pending');
      expect((await jsonFetch(`/api/v1/invitations/${token}`)).status).toBe(410);
    });

    it('rejects inviting an existing member and a duplicate pending invite', async () => {
      const member = await createMemberWithPermissions(admin.organizationId, 'already-member', [
        'project.read',
      ]);
      createdOrganizations.push(member.organizationId);
      const role = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true },
      });

      const duplicateMember = await jsonFetch('/api/v1/admin/invitations', {
        method: 'POST',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ email: member.email, roleId: role.id }),
      });
      expect(duplicateMember.status).toBe(409);

      const email = `twice-${Date.now()}@integration.invalid`;
      const first = await jsonFetch('/api/v1/admin/invitations', {
        method: 'POST',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ email, roleId: role.id }),
      });
      expect(first.status).toBe(201);
      const raceEmail = `race-${Date.now()}@integration.invalid`;
      const race = await Promise.all([
        jsonFetch('/api/v1/admin/invitations', {
          method: 'POST',
          headers: authHeaders(admin.token),
          body: JSON.stringify({ email: raceEmail, roleId: role.id }),
        }),
        jsonFetch('/api/v1/admin/invitations', {
          method: 'POST',
          headers: authHeaders(admin.token),
          body: JSON.stringify({ email: raceEmail.toUpperCase(), roleId: role.id }),
        }),
      ]);
      expect(race.map((item) => item.status).sort()).toEqual([201, 409]);
      expect(
        await prisma.invitation.count({
          where: {
            organizationId: admin.organizationId,
            email: { equals: raceEmail, mode: 'insensitive' },
            status: 'pending',
          },
        })
      ).toBe(1);
    });

    it('prevents an invitation manager from assigning a role with permissions they lack', async () => {
      const manager = await createMemberWithPermissions(admin.organizationId, 'invite-manager', [
        'invitation.create',
      ]);
      createdOrganizations.push(manager.organizationId);
      const administrator = await prisma.role.findFirstOrThrow({
        where: { organizationId: admin.organizationId, isSystem: true, name: 'Administrator' },
      });
      const response = await jsonFetch('/api/v1/admin/invitations', {
        method: 'POST',
        headers: authHeaders(manager.token),
        body: JSON.stringify({
          email: `escalation-${Date.now()}@integration.invalid`,
          roleId: administrator.id,
        }),
      });
      expect(response.status).toBe(403);
    });

    it('cannot invite someone into another organization', async () => {
      const other = await createOrganizationWithAdmin('invite-other');
      createdOrganizations.push(other.organizationId);
      const foreignRole = await prisma.role.findFirstOrThrow({
        where: { organizationId: other.organizationId },
      });

      const res = await jsonFetch('/api/v1/admin/invitations', {
        method: 'POST',
        headers: authHeaders(admin.token),
        body: JSON.stringify({
          email: `x-${Date.now()}@integration.invalid`,
          roleId: foreignRole.id,
        }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('audit log', () => {
    it('is filterable and paginated', async () => {
      const all = await jsonFetch('/api/v1/admin/audit-logs?pageSize=5', {
        headers: authHeaders(admin.token),
      });
      expect(all.status).toBe(200);
      const page = all.body as {
        logs: Array<{ action: string }>;
        total: number;
        page: number;
        totalPages: number;
        actions: string[];
      };
      expect(page.logs.length).toBeLessThanOrEqual(5);
      expect(page.total).toBeGreaterThan(0);
      expect(page.actions.length).toBeGreaterThan(0);

      const filtered = await jsonFetch('/api/v1/admin/audit-logs?action=workflow', {
        headers: authHeaders(admin.token),
      });
      expect(filtered.status).toBe(200);
      for (const log of (filtered.body as { logs: Array<{ action: string }> }).logs) {
        expect(log.action.startsWith('workflow')).toBe(true);
      }
    });

    it('never exposes another organization’s entries', async () => {
      const other = await createOrganizationWithAdmin('audit-other');
      createdOrganizations.push(other.organizationId);
      await prisma.auditLog.create({
        data: {
          organizationId: other.organizationId,
          action: 'secret.action',
          entityType: 'Secret',
          entityId: 'secret-1',
          actorName: 'other-admin',
        },
      });

      const res = await jsonFetch('/api/v1/admin/audit-logs?action=secret', {
        headers: authHeaders(admin.token),
      });
      expect(res.status).toBe(200);
      expect((res.body as { logs: unknown[] }).logs).toEqual([]);
    });

    it('requires authentication', async () => {
      const res = await jsonFetch('/api/v1/admin/audit-logs', {
        headers: { Accept: 'application/json' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('cross-organization isolation', () => {
    it('cannot read or modify another organization’s members', async () => {
      const other = await createOrganizationWithAdmin('isolation');
      createdOrganizations.push(other.organizationId);

      const list = await jsonFetch('/api/v1/admin/users', { headers: authHeaders(admin.token) });
      const rows = list.body as Array<{ id: string }>;
      expect(rows.some((row) => row.id === other.userId)).toBe(false);

      const direct = await jsonFetch(`/api/v1/admin/users/${other.userId}`, {
        headers: authHeaders(admin.token),
      });
      expect(direct.status).toBe(404);

      const write = await jsonFetch(`/api/v1/admin/users/${other.userId}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ status: 'suspended' }),
      });
      expect(write.status).toBe(404);

      const stillActive = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
      expect(stillActive.status).toBe('active');
    });

    it('cannot read or modify another organization’s roles', async () => {
      const other = await createOrganizationWithAdmin('roles-isolation');
      createdOrganizations.push(other.organizationId);
      const foreignRole = await prisma.role.findFirstOrThrow({
        where: { organizationId: other.organizationId },
      });

      const read = await jsonFetch(`/api/v1/admin/roles/${foreignRole.id}`, {
        headers: authHeaders(admin.token),
      });
      expect(read.status).toBe(404);

      const write = await jsonFetch(`/api/v1/admin/roles/${foreignRole.id}`, {
        method: 'PATCH',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ name: 'Hijacked' }),
      });
      expect(write.status).toBe(404);
    });

    it('rejects unauthenticated access to every administration endpoint', async () => {
      for (const path of [
        '/api/v1/admin/users',
        '/api/v1/admin/roles',
        '/api/v1/admin/invitations',
        '/api/v1/admin/feature-flags',
      ]) {
        const res = await jsonFetch(path, { headers: { Accept: 'application/json' } });
        expect(res.status, path).toBe(401);
      }
    });
  });
});
