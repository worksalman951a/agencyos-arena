/**
 * Email ownership verification against real PostgreSQL and the running app.
 * This suite does not change global sign-in policy: legacy/unverified users
 * retain active access, while portal invitation linking checks proof explicitly.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auth } from '@/lib/auth-server';
import {
  EMAIL_VERIFICATION_IDENTIFIER_PREFIX,
  EMAIL_VERIFICATION_REQUEST_MESSAGE,
} from '@/lib/auth/email-verification-policy';
import { emailVerificationIdentifier } from '@/lib/auth/email-verification-token';
import { prisma } from '@/lib/db';
import { passwordResetIdentifier } from '@/lib/auth/password-reset-token';
import { preparePasswordReset } from '@/lib/services/auth/password-reset-service';
import {
  INVALID_EMAIL_VERIFICATION,
  prepareEmailVerification,
  redeemEmailVerification,
} from '@/lib/services/auth/email-verification-service';
import { SERVER_URL } from './test-config';

const canRun = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
const describeIfDb = canRun ? describe : describe.skip;
const SUFFIX = randomUUID().slice(0, 8);
const PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];
let counter = 0;

function emailFor(label: string) {
  counter += 1;
  return `email-verify-${label}-${SUFFIX}-${counter}@integration.invalid`;
}

async function createUser(label: string, email = emailFor(label)) {
  const result = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: `Verification ${label}` },
  });
  if (!result) throw new Error('test user sign-up returned no user');
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return user;
}

describeIfDb('email ownership verification (PostgreSQL integration)', () => {
  beforeAll(async () => {
    const health = await fetch(`${SERVER_URL}/api/health`).catch(() => null);
    if (!health?.ok) throw new Error(`Integration server is not ready at ${SERVER_URL}`);
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdOrganizationIds.length) {
      await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
    }
    await prisma.rateLimitBucket.deleteMany({
      where: {
        OR: [
          { key: { startsWith: 'email-verification-request:' } },
          { key: { startsWith: 'email-verification-request-account:' } },
          { key: { startsWith: 'email-verification-confirm:' } },
        ],
      },
    });
  });

  it('stores only a hash and consumes a valid token exactly once', async () => {
    const user = await createUser('success');
    const prepared = await prepareEmailVerification(user.email);
    expect(prepared).not.toBeNull();

    const row = await prisma.verification.findUniqueOrThrow({
      where: { identifier: prepared!.identifier },
    });
    expect(row.identifier).toBe(emailVerificationIdentifier(prepared!.token));
    expect(row.identifier).toMatch(
      new RegExp(`^${EMAIL_VERIFICATION_IDENTIFIER_PREFIX}[a-f0-9]{64}$`)
    );
    expect(row.value).not.toContain(prepared!.token);
    expect(JSON.stringify(row)).not.toContain(prepared!.token);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000 + 1000);

    await expect(redeemEmailVerification({ token: prepared!.token })).resolves.toEqual({
      status: true,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBe(
      true
    );
    await expect(redeemEmailVerification({ token: prepared!.token })).rejects.toThrow(
      INVALID_EMAIL_VERIFICATION
    );
  });

  it('keeps password-recovery tokens independent from ownership-verification resends', async () => {
    const user = await createUser('password-reset-isolation');
    const recovery = await preparePasswordReset(user.email);
    const ownership = await prepareEmailVerification(user.email);
    expect(recovery).not.toBeNull();
    expect(ownership).not.toBeNull();
    expect(
      await prisma.verification.count({
        where: { identifier: passwordResetIdentifier(recovery!.resetPath.split('/').at(-1)!) },
      })
    ).toBe(1);
    await redeemEmailVerification({ token: ownership!.token });
    expect(
      await prisma.verification.count({
        where: { identifier: passwordResetIdentifier(recovery!.resetPath.split('/').at(-1)!) },
      })
    ).toBe(1);
  });

  it('rejects expired, malformed and unknown tokens without changing user state', async () => {
    const user = await createUser('invalid');
    const prepared = await prepareEmailVerification(user.email);
    await prisma.verification.update({
      where: { identifier: prepared!.identifier },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(redeemEmailVerification({ token: prepared!.token })).rejects.toThrow(
      INVALID_EMAIL_VERIFICATION
    );
    await expect(redeemEmailVerification({ token: 'x'.repeat(43) })).rejects.toThrow(
      INVALID_EMAIL_VERIFICATION
    );
    await expect(redeemEmailVerification({ token: 'too-short' })).rejects.toThrow(
      INVALID_EMAIL_VERIFICATION
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBe(
      false
    );
  });

  it('resend invalidates the previous link and unknown addresses do not create rows', async () => {
    const user = await createUser('resend');
    const first = await prepareEmailVerification(user.email);
    const second = await prepareEmailVerification(user.email);
    expect(second).not.toBeNull();
    expect(first!.identifier).not.toBe(second!.identifier);
    expect(await prisma.verification.count({ where: { identifier: first!.identifier } })).toBe(0);
    await expect(redeemEmailVerification({ token: first!.token })).rejects.toThrow(
      INVALID_EMAIL_VERIFICATION
    );
    await expect(redeemEmailVerification({ token: second!.token })).resolves.toEqual({
      status: true,
    });

    expect(await prepareEmailVerification(emailFor('unknown'))).toBeNull();
  });

  it('retains existing-user sign-in access and never reactivates suspended identities', async () => {
    const legacy = await createUser('legacy');
    expect(legacy.emailVerified).toBe(false);
    const signIn = await auth.api.signInEmail({
      body: { email: legacy.email, password: PASSWORD },
    });
    expect(signIn).toBeTruthy();

    const suspended = await createUser('suspended');
    const prepared = await prepareEmailVerification(suspended.email);
    await prisma.user.update({ where: { id: suspended.id }, data: { status: 'suspended' } });
    await expect(redeemEmailVerification({ token: prepared!.token })).rejects.toThrow(
      INVALID_EMAIL_VERIFICATION
    );
    const after = await prisma.user.findUniqueOrThrow({ where: { id: suspended.id } });
    expect(after.status).toBe('suspended');
    expect(after.emailVerified).toBe(false);
  });

  it('does not verify a changed email address using a link sent to the previous one', async () => {
    const user = await createUser('changed-address');
    const prepared = await prepareEmailVerification(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { email: `changed-${user.email}` },
    });
    await expect(redeemEmailVerification({ token: prepared!.token })).rejects.toThrow(
      INVALID_EMAIL_VERIFICATION
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBe(
      false
    );
  });

  it('verifies the exact client identity and leaves other portal identities isolated', async () => {
    const organization = await prisma.organization.create({
      data: { name: `Ownership Org ${SUFFIX}`, slug: `email-verify-${randomUUID()}` },
    });
    createdOrganizationIds.push(organization.id);
    const clientA = await createUser('client-a');
    const clientB = await createUser('client-b');
    const contactA = await prisma.contact.create({
      data: {
        organizationId: organization.id,
        firstName: 'Client',
        lastName: 'A',
        email: clientA.email,
      },
    });
    const contactB = await prisma.contact.create({
      data: {
        organizationId: organization.id,
        firstName: 'Client',
        lastName: 'B',
        email: clientB.email,
      },
    });
    await Promise.all([
      prisma.user.update({
        where: { id: clientA.id },
        data: { userType: 'client', organizationId: null },
      }),
      prisma.user.update({
        where: { id: clientB.id },
        data: { userType: 'client', organizationId: null },
      }),
    ]);
    await Promise.all([
      prisma.clientAccess.create({
        data: {
          organizationId: organization.id,
          userId: clientA.id,
          contactId: contactA.id,
          status: 'active',
          role: 'client_viewer',
        },
      }),
      prisma.clientAccess.create({
        data: {
          organizationId: organization.id,
          userId: clientB.id,
          contactId: contactB.id,
          status: 'active',
          role: 'client_viewer',
        },
      }),
    ]);

    const revokedToken = await prepareEmailVerification(clientB.email);
    await prisma.clientAccess.updateMany({
      where: { userId: clientB.id },
      data: { status: 'revoked' },
    });
    await expect(redeemEmailVerification({ token: revokedToken!.token })).rejects.toThrow(
      INVALID_EMAIL_VERIFICATION
    );
    expect(
      (await prisma.clientAccess.findUniqueOrThrow({ where: { userId: clientB.id } })).status
    ).toBe('revoked');

    const prepared = await prepareEmailVerification(clientA.email);
    await redeemEmailVerification({ token: prepared!.token });
    const [afterA, afterB] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: clientA.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: clientB.id } }),
    ]);
    expect(afterA.emailVerified).toBe(true);
    expect(afterA.userType).toBe('client');
    expect(afterA.organizationId).toBeNull();
    expect(afterB.emailVerified).toBe(false);
    expect(afterB.userType).toBe('client');
  });

  it('uses one generic request response, applies throttling, and enforces Origin checks', async () => {
    const known = await createUser('request-known');
    const unknownEmail = emailFor('request-unknown');
    const endpoint = '/api/v1/auth/email-verification/request';
    const submit = async (email: string, forwardedFor: string) =>
      fetch(`${SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: SERVER_URL,
          'X-Forwarded-For': forwardedFor,
        },
        body: JSON.stringify({ email }),
      });

    const knownResponse = await submit(
      known.email,
      `198.51.100.${Math.floor(Math.random() * 100) + 1}`
    );
    const knownBody = await knownResponse.json();
    const unknownResponse = await submit(
      unknownEmail,
      `198.51.100.${Math.floor(Math.random() * 100) + 101}`
    );
    const unknownBody = await unknownResponse.json();
    expect(knownResponse.status).toBe(200);
    expect(unknownResponse.status).toBe(200);
    expect(knownBody).toEqual(unknownBody);
    expect(knownBody).toMatchObject({ status: true, message: EMAIL_VERIFICATION_REQUEST_MESSAGE });
    expect(JSON.stringify(knownBody)).not.toContain(known.email);

    const blocked = await fetch(`${SERVER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      body: JSON.stringify({ email: known.email }),
    });
    expect(blocked.status).toBe(403);
    const redemptionCsrf = await fetch(`${SERVER_URL}/api/v1/auth/email-verification/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      body: JSON.stringify({ token: 'A'.repeat(43) }),
    });
    expect(redemptionCsrf.status).toBe(403);

    const unsafeRedirect = await fetch(`${SERVER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ email: known.email, redirectTo: 'https://attacker.example' }),
    });
    expect(unsafeRedirect.status).toBe(400);

    const throttleEmail = emailFor('throttled');
    const throttleAddress = `203.0.113.${Math.floor(Math.random() * 100) + 1}`;
    let final!: Response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      final = await submit(throttleEmail, throttleAddress);
    }
    expect(final.status).toBe(429);
    expect(final.headers.get('retry-after')).toBeTruthy();
  });
});
