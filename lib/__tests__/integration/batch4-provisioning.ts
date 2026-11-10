/**
 * Provisioning helpers for the Phase 3A Batch 4 integration suites.
 *
 * Better Auth rate-limits `/sign-up/email` (3 requests per window per IP), and
 * the whole suite runs from one address. Rather than weaken that protection,
 * these helpers sign up **one** admin over HTTP and then provision additional
 * members (and their sessions) directly in the database.
 *
 * What stays real: every request in the tests still goes over HTTP to the
 * running server, so session validation, RBAC, organization scoping and audit
 * logging are all exercised exactly as a browser would exercise them. Only the
 * account provisioning is direct.
 */

import { randomUUID } from 'node:crypto';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Better Auth ships this helper without public types.
import { makeSignature } from 'better-auth/crypto';

import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

export const PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

export interface TestAccount {
  userId: string;
  organizationId: string;
  email: string;
  token: string;
}

export function authHeaders(token: string): Record<string, string> {
  return {
    Cookie: `better-auth.session_token=${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Origin: SERVER_URL,
  };
}

export async function jsonFetch(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${SERVER_URL}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function uniqueEmail(label: string, domain: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
}

/**
 * Insert a session row directly and return the **signed** cookie value.
 *
 * Better Auth stores `session.token` in the database but the cookie carries
 * `token.signature`, so a raw token is rejected as tampered. Signing with the
 * same HMAC the server uses keeps the fixture honest: the server performs its
 * full signature + database validation, exactly as it would for a browser.
 */
export async function sessionFor(userId: string): Promise<string> {
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required to sign test session cookies');
  }
  const signature = await makeSignature(token, secret);
  return `${token}.${signature}`;
}

/**
 * Sign up over HTTP, bootstrap an organization, and return a usable account.
 * Call this at most once or twice per suite (rate limiting).
 */
export async function createBootstrappedAccount(
  label: string,
  domain = 'integration.invalid'
): Promise<TestAccount> {
  const email = uniqueEmail(label, domain);

  const signUp = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD, name: `Integration ${label}` }),
  });
  if (signUp.status !== 200) {
    throw new Error(`sign-up failed with ${signUp.status}: ${await signUp.text()}`);
  }

  const signIn = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (signIn.status !== 200) {
    throw new Error(`sign-in failed with ${signIn.status}: ${await signIn.text()}`);
  }
  const rawToken =
    (signIn.headers.get('set-cookie') ?? '').match(/better-auth\.session_token=([^;]+)/)?.[1] ?? '';

  const bootstrap = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: authHeaders(decodeURIComponent(rawToken)),
    body: JSON.stringify({ organizationName: `Integration Org ${label} ${Date.now()}` }),
  });
  if (bootstrap.status !== 200) {
    throw new Error(`bootstrap failed with ${bootstrap.status}: ${await bootstrap.text()}`);
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return {
    userId: user.id,
    organizationId: user.organizationId!,
    email,
    token: decodeURIComponent(rawToken),
  };
}

/** Create an organization with its own administrator, without HTTP sign-up. */
export async function createOrganizationWithAdmin(label: string): Promise<TestAccount> {
  const email = uniqueEmail(label, 'integration.invalid');
  const organization = await prisma.organization.create({
    data: { name: `Isolated Org ${label} ${Date.now()}`, slug: `isolated-${randomUUID()}` },
  });

  const user = await prisma.user.create({
    data: {
      email,
      name: `Isolated ${label}`,
      organizationId: organization.id,
      role: 'admin',
      status: 'active',
    },
  });

  const role = await prisma.role.create({
    data: {
      organizationId: organization.id,
      name: 'Administrator',
      isSystem: true,
      description: 'Full access to all organization resources',
    },
  });

  const permissions = await prisma.permission.findMany({ select: { id: true } });
  await prisma.rolePermission.createMany({
    data: permissions.map((permission: { id: string }) => ({
      roleId: role.id,
      permissionId: permission.id,
    })),
  });

  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: role.id,
      organizationId: organization.id,
      assignedBy: user.id,
    },
  });

  return {
    userId: user.id,
    organizationId: organization.id,
    email,
    token: await sessionFor(user.id),
  };
}

/**
 * Add a member to an existing organization with an explicit permission set.
 * Returns the account (with a session token) and the created role id.
 */
export async function createMemberWithPermissions(
  organizationId: string,
  label: string,
  permissionCodes: string[]
): Promise<TestAccount & { roleId: string }> {
  const user = await prisma.user.create({
    data: {
      email: uniqueEmail(`member-${label}`, 'integration.invalid'),
      name: `Member ${label}`,
      organizationId,
      status: 'active',
    },
  });

  const role = await prisma.role.create({
    data: { organizationId, name: `Role ${label} ${randomUUID().slice(0, 8)}`, isSystem: false },
  });

  const permissions = await prisma.permission.findMany({
    where: { code: { in: permissionCodes } },
    select: { id: true, code: true },
  });
  const missing = permissionCodes.filter(
    (code) => !(permissions as Array<{ code: string }>).some((p) => p.code === code)
  );
  if (missing.length > 0) {
    throw new Error(`Unknown permission codes: ${missing.join(', ')}`);
  }

  await prisma.rolePermission.createMany({
    data: permissions.map((permission: { id: string }) => ({
      roleId: role.id,
      permissionId: permission.id,
    })),
  });

  await prisma.userRole.create({
    data: { userId: user.id, roleId: role.id, organizationId },
  });

  return {
    userId: user.id,
    organizationId,
    email: user.email,
    token: await sessionFor(user.id),
    roleId: role.id,
  };
}

/** Remove every organization a suite created (cascades to its data). */
export async function cleanupOrganizations(organizationIds: string[]): Promise<void> {
  const unique = Array.from(new Set(organizationIds.filter(Boolean)));
  if (unique.length === 0) return;
  await prisma.organization.deleteMany({ where: { id: { in: unique } } });
}
