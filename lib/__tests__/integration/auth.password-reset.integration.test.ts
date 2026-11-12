/**
 * Phase 4D / Batch 4B - secure password recovery, against real PostgreSQL and
 * a real HTTP server.
 *
 * What is proven here:
 *  - a known and an unknown address receive the same status and body, and no
 *    token appears in either response;
 *  - only a SHA-256 hash is stored (`Verification` row), the raw token is never
 *    persisted, and a new request invalidates the previous unused link;
 *  - a valid token is single-use: the first redemption changes the password,
 *    revokes every session, and a replay gets the generic invalid answer;
 *  - expired, malformed and reused tokens are refused;
 *  - the password policy is enforced *before* the token is spent;
 *  - the address and per-address budgets return 429 with Retry-After;
 *  - suspended internal users and suspended/revoked client-portal identities
 *    can neither receive nor redeem a link, and a reset never reactivates them;
 *  - a client-portal identity can recover its password and sign back in;
 *  - CSRF / Origin enforcement covers both mutating recovery routes;
 *  - disabled or unreachable e-mail delivery leaves no redeemable link;
 *  - Better Auth's own reset endpoint cannot consume this application's hashed
 *    rows, and the vendor request endpoint stays inert;
 *  - other accounts' sessions survive one user's reset.
 *
 * Requires DATABASE_URL, BETTER_AUTH_SECRET and a server on TEST_SERVER_URL
 * (defaults to BETTER_AUTH_URL, then http://localhost:3001). Skips without a
 * database, exactly like the other integration suites.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { auth } from '@/lib/auth-server';
import { createPasswordResetToken, passwordResetIdentifier } from '@/lib/auth/password-reset-token';
import { prisma } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email/password-reset-emails';
import {
  discardPasswordReset,
  preparePasswordReset,
  redeemPasswordReset,
} from '@/lib/services/auth/password-reset-service';
import { SERVER_URL } from './test-config';
import { sessionFor } from './batch4-provisioning';

const canRun = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
const describeIfDb = canRun ? describe : describe.skip;

const PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';
const NEW_PASSWORD = 'new_arena_password_2026';
const SUFFIX = randomUUID().slice(0, 8);

type Json = Record<string, unknown> | null;

interface HttpResult {
  status: number;
  json: Json;
  text: string;
  headers: Headers;
}

let addressCounter = 0;

/** A distinct client address per request, so one test cannot spend another's budget. */
function clientAddress(): string {
  addressCounter += 1;
  return `198.51.100.${(addressCounter % 200) + 1}`;
}

async function http(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    cookie?: string | null;
    origin?: string | null;
    forwardedFor?: string | null;
  } = {}
): Promise<HttpResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(init.cookie ? { Cookie: `better-auth.session_token=${init.cookie}` } : {}),
    ...(init.origin === null ? {} : { Origin: init.origin ?? SERVER_URL }),
    ...(init.forwardedFor ? { 'X-Forwarded-For': init.forwardedFor } : {}),
  };

  const response = await fetch(`${SERVER_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'manual',
  });

  const text = await response.text();
  let json: Json = null;
  try {
    json = text ? (JSON.parse(text) as Json) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

function emailFor(label: string): string {
  return `${label}-${SUFFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@reset.integration.invalid`;
}

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

/** Create an internal identity with a real Better Auth credential. */
async function createInternalUser(label: string): Promise<{ id: string; email: string }> {
  const email = emailFor(label);
  const result = (await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: `Reset ${label}` },
  })) as unknown;
  if (!result) throw new Error(`sign-up failed for ${email}`);

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return { id: user.id, email };
}

/**
 * Create an active client-portal identity: a client user with no organization,
 * a credential account, and an active `ClientAccess` row bound to a contact.
 * This is the shape invitation acceptance produces.
 */
async function createClientUser(label: string): Promise<{ id: string; email: string }> {
  const email = emailFor(label);
  const organization = await prisma.organization.create({
    data: { name: `Reset Client Org ${label} ${SUFFIX}`, slug: `reset-client-${randomUUID()}` },
  });
  createdOrganizationIds.push(organization.id);

  const contact = await prisma.contact.create({
    data: { organizationId: organization.id, firstName: 'Client', lastName: label, email },
  });

  const result = (await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: `Client ${label}` },
  })) as unknown;
  if (!result) throw new Error(`client sign-up failed for ${email}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  await prisma.user.update({
    where: { id: user.id },
    data: { userType: 'client', organizationId: null, status: 'active' },
  });
  await prisma.clientAccess.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      contactId: contact.id,
      status: 'active',
      role: 'client_viewer',
    },
  });

  createdUserIds.push(user.id);
  return { id: user.id, email };
}

function tokenFromPath(resetPath: string): string {
  return resetPath.slice(resetPath.lastIndexOf('/') + 1);
}

async function passwordHashFor(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: 'credential' },
    select: { password: true },
  });
  return account?.password ?? null;
}

async function signInOverHttp(email: string, password: string) {
  return http('/api/auth/sign-in/email', {
    method: 'POST',
    body: { email, password },
  });
}

beforeAll(async () => {
  await prisma.$connect();
  // Warm the server so the first measured request is not a cold start.
  await fetch(`${SERVER_URL}/api/auth/get-session`, { headers: { Accept: 'application/json' } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.verification.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await prisma.clientAccess.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrganizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
  await prisma.rateLimitBucket.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'password-reset-request:' } },
        { key: { startsWith: 'password-reset-request-account:' } },
        { key: { startsWith: 'password-reset-confirm:' } },
        { key: { startsWith: 'password-reset-email-' } },
      ],
    },
  });
});

describeIfDb('password reset - request and storage', () => {
  it('answers a known and an unknown address identically, with no token in the body', async () => {
    const known = await createInternalUser('known-response');
    const unknownEmail = `missing-${SUFFIX}@reset.integration.invalid`;

    const forKnown = await http('/api/v1/auth/password-reset/request', {
      method: 'POST',
      body: { email: known.email },
      forwardedFor: clientAddress(),
    });
    const forUnknown = await http('/api/v1/auth/password-reset/request', {
      method: 'POST',
      body: { email: unknownEmail },
      forwardedFor: clientAddress(),
    });

    expect(forKnown.status).toBe(200);
    expect(forUnknown.status).toBe(200);
    expect(forKnown.text).toBe(forUnknown.text);
    expect(forKnown.json).toEqual({
      status: true,
      message:
        'If an account exists for that e-mail address, a password reset link has been sent. Check your inbox and spam folder.',
    });

    // Neither answer may carry the credential.
    expect(forKnown.text).not.toMatch(/tok_|reset-password|password-reset:/);
    expect(forUnknown.text).not.toMatch(/tok_|reset-password|password-reset:/);
    expect(forKnown.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects a malformed request before looking anything up', async () => {
    const response = await http('/api/v1/auth/password-reset/request', {
      method: 'POST',
      body: { email: 'not-an-address' },
      forwardedFor: clientAddress(),
    });

    expect(response.status).toBe(400);
    expect(response.text).not.toMatch(/tok_|reset-password|password-reset:/);
  });

  it('refuses a caller-chosen redirect or callback target', async () => {
    const user = await createInternalUser('no-open-redirect');

    for (const body of [
      { email: user.email, redirectTo: 'https://evil.example/' },
      { email: user.email, callbackUrl: 'https://evil.example/' },
    ]) {
      const response = await http('/api/v1/auth/password-reset/request', {
        method: 'POST',
        body,
        forwardedFor: clientAddress(),
      });
      expect(response.status).toBe(400);
    }

    // Nothing was minted for the rejected requests.
    expect(await prisma.verification.count({ where: { userId: user.id } })).toBe(0);

    const prepared = await preparePasswordReset(user.email);
    const token = tokenFromPath(prepared!.resetPath);
    const confirm = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: {
        token,
        newPassword: NEW_PASSWORD,
        redirectTo: 'https://evil.example/',
      },
      forwardedFor: clientAddress(),
    });
    expect(confirm.status).toBe(400);
    // The extra field did not spend the token.
    expect(await prisma.verification.count({ where: { identifier: prepared!.identifier } })).toBe(
      1
    );
  });

  it('stores only a SHA-256 hash and keeps one live link per account', async () => {
    const user = await createInternalUser('storage');

    const first = await preparePasswordReset(user.email);
    expect(first).not.toBeNull();
    const firstToken = tokenFromPath(first!.resetPath);

    const rows = await prisma.verification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe(passwordResetIdentifier(firstToken));
    expect(rows[0].identifier).toMatch(/^password-reset:[0-9a-f]{64}$/);
    expect(rows[0].value).toBe(user.id);
    expect(JSON.stringify(rows)).not.toContain(firstToken);

    // Requesting again invalidates the earlier unused link.
    const second = await preparePasswordReset(user.email);
    expect(second).not.toBeNull();
    const secondToken = tokenFromPath(second!.resetPath);

    const afterSecond = await prisma.verification.findMany({ where: { userId: user.id } });
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].identifier).toBe(passwordResetIdentifier(secondToken));

    await expect(
      redeemPasswordReset({ token: firstToken, newPassword: NEW_PASSWORD })
    ).rejects.toMatchObject({ statusCode: 400 });

    // The live one still works, so the earlier rejection was about single use.
    await expect(
      redeemPasswordReset({ token: secondToken, newPassword: NEW_PASSWORD })
    ).resolves.toEqual({ status: true });
  });
});

describeIfDb('password reset - redemption', () => {
  it('changes the password once, revokes every session and refuses a replay', async () => {
    const user = await createInternalUser('redeem');
    const staleSession = await sessionFor(user.id);
    const before = await http('/api/auth/get-session', { cookie: staleSession });
    expect(before.json).not.toBeNull();

    const prepared = await preparePasswordReset(user.email);
    expect(prepared).not.toBeNull();
    const token = tokenFromPath(prepared!.resetPath);

    const response = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(response.status, response.text).toBe(200);
    expect(response.json).toEqual({ status: true });

    // Every session for the account is gone, including the stale cookie.
    const afterReset = await http('/api/auth/get-session', { cookie: staleSession });
    expect(afterReset.status).toBe(200);
    expect(afterReset.json).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

    // The old password no longer signs in; the new one does.
    expect((await signInOverHttp(user.email, PASSWORD)).status).not.toBe(200);
    const newSignIn = await signInOverHttp(user.email, NEW_PASSWORD);
    expect(newSignIn.status, newSignIn.text).toBe(200);

    // The link was single-use. The answer is the generic one.
    const replay = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: 'another_password_2026' },
      forwardedFor: clientAddress(),
    });
    expect(replay.status).toBe(400);
    expect(replay.json).toEqual({
      error: 'This password reset link is invalid or has expired. Request a new one.',
    });
  });

  it('leaves other accounts and their sessions untouched', async () => {
    const changed = await createInternalUser('isolation-a');
    const untouched = await createInternalUser('isolation-b');
    const untouchedSession = await sessionFor(untouched.id);

    const prepared = await preparePasswordReset(changed.email);
    const token = tokenFromPath(prepared!.resetPath);
    const response = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(response.status).toBe(200);

    const stillSignedIn = await http('/api/auth/get-session', { cookie: untouchedSession });
    expect(stillSignedIn.json).not.toBeNull();
    expect((await signInOverHttp(untouched.email, PASSWORD)).status).toBe(200);
  });

  it('refuses expired, malformed and unknown tokens with the same answer', async () => {
    const user = await createInternalUser('invalid-tokens');

    const expired = createPasswordResetToken();
    await prisma.verification.create({
      data: {
        identifier: expired.identifier,
        value: user.id,
        userId: user.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const expiredResponse = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token: expired.token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(expiredResponse.status).toBe(400);
    expect(expiredResponse.json).toEqual({
      error: 'This password reset link is invalid or has expired. Request a new one.',
    });
    expect(await prisma.verification.count({ where: { identifier: expired.identifier } })).toBe(0);

    for (const token of ['short', 'a'.repeat(43), 'a'.repeat(43) + '/', 'z'.repeat(64)]) {
      const response = await http('/api/v1/auth/password-reset/confirm', {
        method: 'POST',
        body: { token, newPassword: NEW_PASSWORD },
        forwardedFor: clientAddress(),
      });
      expect(response.status, token).toBe(400);
      expect(response.json).toEqual(expiredResponse.json);
    }
  });

  it('enforces the password policy before spending the token', async () => {
    const user = await createInternalUser('policy');
    const prepared = await preparePasswordReset(user.email);
    const token = tokenFromPath(prepared!.resetPath);
    const hashBefore = await passwordHashFor(user.id);

    for (const [newPassword, expected] of [
      ['short', 'Password must be at least 8 characters.'],
      ['a'.repeat(129), 'Password must be at most 128 characters.'],
      ['        ', 'A password is required.'],
    ] as const) {
      const response = await http('/api/v1/auth/password-reset/confirm', {
        method: 'POST',
        body: { token, newPassword },
        forwardedFor: clientAddress(),
      });
      expect(response.status, newPassword).toBe(400);
      expect(response.json).toEqual({ error: expected });
    }

    // A rejected password must not have spent the link.
    expect(await passwordHashFor(user.id)).toBe(hashBefore);
    expect(await prisma.verification.count({ where: { identifier: prepared!.identifier } })).toBe(
      1
    );

    const accepted = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(accepted.status).toBe(200);
  });
});

describeIfDb('password reset - throttling', () => {
  it('limits requests per client address and still answers 429 generically', async () => {
    const address = clientAddress();
    const statuses: number[] = [];
    let limited: HttpResult | null = null;

    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await http('/api/v1/auth/password-reset/request', {
        method: 'POST',
        body: { email: `throttle-${SUFFIX}-${attempt}@reset.integration.invalid` },
        forwardedFor: address,
      });
      statuses.push(response.status);
      if (response.status === 429) limited = response;
    }

    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(limited).not.toBeNull();
    expect(limited!.json).toEqual({ error: 'Too many requests. Please try again later.' });
    expect(Number(limited!.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(limited!.headers.get('RateLimit-Limit')).toBe('10');
  });

  it('limits requests per recipient address even from different clients', async () => {
    const email = `account-budget-${SUFFIX}@reset.integration.invalid`;
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await http('/api/v1/auth/password-reset/request', {
        method: 'POST',
        body: { email },
        forwardedFor: clientAddress(),
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('limits redemption attempts per client address', async () => {
    const address = clientAddress();
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await http('/api/v1/auth/password-reset/confirm', {
        method: 'POST',
        body: {
          token: `${attempt}`.padStart(43, 'a').slice(-43),
          newPassword: NEW_PASSWORD,
        },
        forwardedFor: address,
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 20).every((status) => status === 400)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describeIfDb('password reset - account status', () => {
  it('does not issue a link for a suspended or removed internal user', async () => {
    const user = await createInternalUser('suspended-no-link');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });

    await expect(preparePasswordReset(user.email)).resolves.toBeNull();
    expect(await prisma.verification.count({ where: { userId: user.id } })).toBe(0);

    // The HTTP answer stays the uniform one.
    const response = await http('/api/v1/auth/password-reset/request', {
      method: 'POST',
      body: { email: user.email },
      forwardedFor: clientAddress(),
    });
    expect(response.status).toBe(200);
    expect(response.json).toEqual(
      expect.objectContaining({ status: true, message: expect.stringContaining('If an account') })
    );

    // A "removed" member is the same row with the organization cleared.
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'suspended', organizationId: null },
    });
    await expect(preparePasswordReset(user.email)).resolves.toBeNull();
  });

  it('refuses a link issued before a suspension and never reactivates the account', async () => {
    const user = await createInternalUser('suspended-after-issue');
    const prepared = await preparePasswordReset(user.email);
    const token = tokenFromPath(prepared!.resetPath);
    const hashBefore = await passwordHashFor(user.id);

    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });

    const response = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      error: 'This password reset link is invalid or has expired. Request a new one.',
    });
    expect(await passwordHashFor(user.id)).toBe(hashBefore);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { status: true },
    });
    expect(row.status).toBe('suspended');
    expect((await signInOverHttp(user.email, PASSWORD)).status).not.toBe(200);

    // The token was spent by the attempt, so it cannot be retried after a
    // hypothetical reactivation.
    await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } });
    const retry = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(retry.status).toBe(400);
  });

  it('refuses a link whose account has been deleted', async () => {
    const user = await createInternalUser('deleted-account');
    const prepared = await preparePasswordReset(user.email);
    const token = tokenFromPath(prepared!.resetPath);

    await prisma.user.delete({ where: { id: user.id } });
    createdUserIds.splice(createdUserIds.indexOf(user.id), 1);

    const response = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(response.status).toBe(400);
  });
});

describeIfDb('password reset - Client Portal identities', () => {
  it('recovers an active client password and signs the client back in', async () => {
    const client = await createClientUser('active-client');
    const staleSession = await sessionFor(client.id);
    expect((await http('/api/auth/get-session', { cookie: staleSession })).json).not.toBeNull();

    const prepared = await preparePasswordReset(client.email);
    expect(prepared).not.toBeNull();
    const token = tokenFromPath(prepared!.resetPath);

    const response = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(response.status, response.text).toBe(200);

    expect((await http('/api/auth/get-session', { cookie: staleSession })).json).toBeNull();
    expect((await signInOverHttp(client.email, PASSWORD)).status).not.toBe(200);

    const signIn = await signInOverHttp(client.email, NEW_PASSWORD);
    expect(signIn.status, signIn.text).toBe(200);

    // The session belongs to a client identity, not an internal one: the
    // account in the database is still `userType = "client"` with no
    // organization, and only the active ClientAccess row let it sign in.
    const cookieMatch = signIn.headers
      .get('set-cookie')
      ?.match(/better-auth\.session_token=([^;]+)/)?.[1];
    expect(cookieMatch).toBeTruthy();
    const session = await http('/api/auth/get-session', {
      cookie: decodeURIComponent(cookieMatch!),
    });
    expect(session.json).not.toBeNull();
    const clientRow = await prisma.user.findUniqueOrThrow({
      where: { id: client.id },
      select: { userType: true, organizationId: true },
    });
    expect(clientRow).toEqual({ userType: 'client', organizationId: null });
  });

  it('does not issue or redeem a link for a suspended or revoked client', async () => {
    const client = await createClientUser('suspended-client');
    const prepared = await preparePasswordReset(client.email);
    const token = tokenFromPath(prepared!.resetPath);
    const hashBefore = await passwordHashFor(client.id);

    await prisma.clientAccess.updateMany({
      where: { userId: client.id },
      data: { status: 'revoked', revokedAt: new Date() },
    });

    await expect(preparePasswordReset(client.email)).resolves.toBeNull();

    const response = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(response.status).toBe(400);
    expect(await passwordHashFor(client.id)).toBe(hashBefore);
    expect((await signInOverHttp(client.email, PASSWORD)).status).not.toBe(200);
  });
});

describeIfDb('password reset - CSRF and Origin', () => {
  it('rejects a foreign origin on both mutating routes, before any work', async () => {
    const user = await createInternalUser('csrf');
    const prepared = await preparePasswordReset(user.email);
    const token = tokenFromPath(prepared!.resetPath);
    const hashBefore = await passwordHashFor(user.id);

    for (const path of [
      '/api/v1/auth/password-reset/request',
      '/api/v1/auth/password-reset/confirm',
    ]) {
      const response = await http(path, {
        method: 'POST',
        body: { email: user.email, token, newPassword: NEW_PASSWORD },
        origin: 'https://evil.example',
        forwardedFor: clientAddress(),
      });
      expect(response.status, path).toBe(403);
      expect(response.json).toEqual({ error: 'Cross-origin request rejected' });
    }

    const missingOrigin = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      origin: null,
      forwardedFor: clientAddress(),
    });
    expect(missingOrigin.status).toBe(403);

    // The refused requests did not spend the token or change the password.
    expect(await prisma.verification.count({ where: { identifier: prepared!.identifier } })).toBe(
      1
    );
    expect(await passwordHashFor(user.id)).toBe(hashBefore);

    const accepted = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(accepted.status).toBe(200);
  });

  it('never refuses a safe method on the public recovery pages', async () => {
    for (const path of ['/forgot-password', '/reset-password/not-a-real-token']) {
      const response = await fetch(`${SERVER_URL}${path}`, {
        headers: { Origin: 'https://evil.example' },
        redirect: 'manual',
      });
      expect(response.status, path).toBe(200);
    }
  });
});

describeIfDb('password reset - e-mail failure', () => {
  it('leaves no redeemable link when delivery is disabled', async () => {
    const user = await createInternalUser('email-disabled');
    const prepared = await preparePasswordReset(user.email);
    expect(prepared).not.toBeNull();

    const delivery = await sendPasswordResetEmail({
      to: prepared!.to,
      resetPath: prepared!.resetPath,
      expiresAt: prepared!.expiresAt,
    });
    expect(delivery.status).toBe('disabled');

    await discardPasswordReset(prepared!.identifier);
    expect(await prisma.verification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('leaves no redeemable link when the relay is unreachable', async () => {
    const user = await createInternalUser('email-unreachable');
    const prepared = await preparePasswordReset(user.email);
    expect(prepared).not.toBeNull();

    vi.stubEnv('EMAIL_TRANSPORT', 'smtp');
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_PORT', '1');
    vi.stubEnv('SMTP_TIMEOUT_MS', '1000');
    vi.stubEnv('SMTP_MAX_ATTEMPTS', '1');
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'no-reply@example.test');
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.test');

    const delivery = await sendPasswordResetEmail({
      to: prepared!.to,
      resetPath: prepared!.resetPath,
      expiresAt: prepared!.expiresAt,
    });
    expect(delivery.status).toBe('failed');

    await discardPasswordReset(prepared!.identifier);
    expect(await prisma.verification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does not change e-mail verification when a password is reset', async () => {
    const user = await createInternalUser('email-verified-unchanged');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: false } });

    const prepared = await preparePasswordReset(user.email);
    const token = tokenFromPath(prepared!.resetPath);
    await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { emailVerified: true },
    });
    expect(after.emailVerified).toBe(false);
  });
});

describeIfDb('password reset - Better Auth endpoint boundary', () => {
  it('cannot redeem a hashed row through the vendor endpoint', async () => {
    const user = await createInternalUser('vendor-endpoint');
    const prepared = await preparePasswordReset(user.email);
    const token = tokenFromPath(prepared!.resetPath);
    const hashBefore = await passwordHashFor(user.id);

    // An attacker who read the database knows the stored identifier, not the
    // preimage. Passing it (or its hash suffix) to the vendor endpoint must not
    // work, because that endpoint looks under `reset-password:<value>`.
    for (const candidate of [prepared!.identifier, prepared!.identifier.slice(-64)]) {
      const response = await http('/api/auth/reset-password', {
        method: 'POST',
        body: { token: candidate, newPassword: NEW_PASSWORD },
        forwardedFor: clientAddress(),
      });
      expect(response.status).not.toBe(200);
    }

    expect(await passwordHashFor(user.id)).toBe(hashBefore);
    expect(await prisma.verification.count({ where: { identifier: prepared!.identifier } })).toBe(
      1
    );

    // The genuine token still works through the application's own route.
    const accepted = await http('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword: NEW_PASSWORD },
      forwardedFor: clientAddress(),
    });
    expect(accepted.status).toBe(200);
  });

  it('leaves the vendor request endpoint inert (no plaintext token row)', async () => {
    const user = await createInternalUser('vendor-request');

    const response = await http('/api/auth/request-password-reset', {
      method: 'POST',
      body: { email: user.email },
      forwardedFor: clientAddress(),
    });
    expect(response.status).not.toBe(200);

    const rows = await prisma.verification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(0);
  });
});
