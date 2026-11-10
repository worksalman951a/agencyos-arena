/**
 * Integration: duplicate registration (real PostgreSQL).
 *
 * The app runs Better Auth with `autoSignIn: false`, which makes a sign-up for
 * an existing email answer with the same generic 200 as a fresh registration
 * (account-enumeration protection). This test pins the parts of that contract
 * that are security-relevant and can only be verified against a database:
 *
 *  - no session token is issued to the second caller,
 *  - no second user row is created,
 *  - the canonical account still signs in with its original password.
 *
 * Requires DATABASE_URL; skips otherwise (runs in CI against the service
 * database, never against a developer's data).
 */

import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';
const email = `dup-${Date.now()}@dup-test.invalid`;

const signUp = (body: Record<string, unknown>) =>
  fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify(body),
  });

describeIfDb('Duplicate registration (real PostgreSQL)', () => {
  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email }, select: { id: true } });
    for (const user of users) {
      await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it('creates exactly one account and issues no second session', async () => {
    const payload = { email, password: PASSWORD, name: 'Duplicate Test' };

    const first = await signUp(payload);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { user?: { id: string } };
    expect(firstBody.user?.id).toBeTruthy();

    const duplicate = await signUp(payload);
    expect(duplicate.status).toBe(200);
    const duplicateBody = (await duplicate.json()) as { token?: string | null };
    expect(duplicateBody.token ?? null).toBeNull();

    const users = await prisma.user.findMany({ where: { email }, select: { id: true } });
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(firstBody.user!.id);

    // The original account is untouched and can still authenticate.
    const signIn = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: SERVER_URL,
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(signIn.status).toBe(200);
    const signInBody = (await signIn.json()) as { user?: { id: string } };
    expect(signInBody.user?.id).toBe(firstBody.user!.id);

    await prisma.session.deleteMany({ where: { userId: firstBody.user!.id } });
  });
});
