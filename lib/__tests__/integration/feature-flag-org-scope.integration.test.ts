/**
 * Integration test: feature flags are scoped per organization.
 *
 * Regression for the CI blocker where `0001_init` created
 * `CREATE UNIQUE INDEX "FeatureFlag_flagKey_key" ON "FeatureFlag"("flagKey")` — a
 * GLOBAL unique index — while bootstrap-organization seeds one `bento_shell` row
 * per organization and every read path filters by organizationId.
 *
 * The consequence was that the first organization bootstrapped and every later
 * one failed with
 *
 *   Unique constraint failed on the constraint: `FeatureFlag_flagKey_key`
 *
 * and `/api/auth/bootstrap-organization` answered 500. Every Playwright spec that
 * creates its own tenant died on that ("bootstrap failed: Internal error").
 *
 * These tests prove, on a real migrated PostgreSQL database and a real running
 * server, that:
 *  - two independent organizations can bootstrap;
 *  - each gets its own `bento_shell` row, and both are enabled by default;
 *  - the rows are genuinely per-tenant and independently mutable, so changing
 *    one organization's flag never changes another's (tenant isolation);
 *  - a duplicate key inside ONE organization is still rejected, so the constraint
 *    was narrowed, not dropped.
 *
 * Requires DATABASE_URL and BETTER_AUTH_SECRET. Requires a running Next.js
 * server (TEST_SERVER_URL / BETTER_AUTH_URL, default http://localhost:3001).
 * Skips gracefully when there is no database. The migration must already have
 * been applied (`prisma migrate deploy`), exactly as CI does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const DATABASE_URL = process.env.DATABASE_URL;
const canRunTests = !!DATABASE_URL;

const describeIfDb = canRunTests ? describe : describe.skip;

const TEST_EMAIL_SUFFIX = '@feature-flag-scope-test.invalid';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

interface BootstrappedOrg {
  userId: string;
  organizationId: string;
  organizationName: string;
  sessionToken: string;
}

/** Sign up, sign in, bootstrap an organization. Mirrors a real onboarding. */
async function bootstrapOrganization(label: string): Promise<BootstrappedOrg> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${TEST_EMAIL_SUFFIX}`;
  const name = `Flag Scope ${label}`;
  const organizationName = `E2E Flag Scope ${label} ${Date.now()}`;

  const signUpRes = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: TEST_PASSWORD, name }),
  });
  expect(signUpRes.status, `sign-up failed: ${await signUpRes.text()}`).toBe(200);

  const signInRes = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  expect(signInRes.status, `sign-in failed: ${await signInRes.text()}`).toBe(200);

  let sessionToken: string | null = null;
  for (const cookie of signInRes.headers.getSetCookie?.() ?? []) {
    const match = /better-auth\.session_token=([^;]+)/.exec(cookie);
    if (match) sessionToken = decodeURIComponent(match[1]);
  }
  expect(sessionToken, 'sign-in did not return a session cookie').toBeTruthy();

  const bootstrapRes = await fetch(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `better-auth.session_token=${sessionToken}`,
      Origin: SERVER_URL,
    },
    body: JSON.stringify({ organizationName }),
  });

  const body = await bootstrapRes.text();
  expect(
    bootstrapRes.status,
    `bootstrap failed for "${label}" — this is the FeatureFlag global-uniqueness regression: ${body}`
  ).toBe(200);

  const parsed = JSON.parse(body) as {
    organization: { id: string };
    user: { id: string; organizationId: string };
  };

  return {
    userId: parsed.user.id,
    organizationId: parsed.organization.id,
    organizationName,
    sessionToken: sessionToken!,
  };
}

describeIfDb('FeatureFlag uniqueness is scoped per organization', () => {
  const created: BootstrappedOrg[] = [];

  beforeAll(async () => {
    // Skip cleanly when the server is not running (same convention as the rest
    // of the integration suite: a database without a server is a configuration
    // error, but a missing server in a unit-only run is not).
    try {
      const ping = await fetch(`${SERVER_URL}/api/auth/get-session`);
      if (!ping.ok && ping.status !== 401) {
        throw new Error(`unexpected status ${ping.status}`);
      }
    } catch (error) {
      throw new Error(
        `Integration tests need a running server at ${SERVER_URL}: ${(error as Error).message}`
      );
    }
  });

  afterAll(async () => {
    // Remove only what this file created, tenant by tenant.
    for (const org of created) {
      await prisma.featureFlag.deleteMany({ where: { organizationId: org.organizationId } });
      await prisma.userRole.deleteMany({ where: { organizationId: org.organizationId } });
      await prisma.user.deleteMany({ where: { id: org.userId } });
      await prisma.role.deleteMany({ where: { organizationId: org.organizationId } });
      await prisma.organization.deleteMany({ where: { id: org.organizationId } });
    }
  });

  it('lets two organizations bootstrap on the same migrated database', async () => {
    // Two independent sign-ups, two independent organizations, one database.
    // Under the global unique index the second bootstrap returned 500 here.
    const first = await bootstrapOrganization('alpha');
    created.push(first);

    const second = await bootstrapOrganization('beta');
    created.push(second);

    expect(first.organizationId).not.toBe(second.organizationId);
  });

  it('gives each organization its own enabled bento_shell flag', async () => {
    expect(created, 'the bootstrap test above must have run').toHaveLength(2);

    interface ScopedFlag {
      organizationId: string;
      flagKey: string;
      enabled: boolean;
    }

    const flags = (await prisma.featureFlag.findMany({
      where: {
        organizationId: { in: created.map((org) => org.organizationId) },
        flagKey: 'bento_shell',
      },
      orderBy: { organizationId: 'asc' },
    })) as ScopedFlag[];

    // One row per organization for the SAME key — the whole point of the fix.
    expect(flags).toHaveLength(2);
    expect(new Set(flags.map((flag) => flag.organizationId)).size).toBe(2);
    expect(flags.every((flag) => flag.flagKey === 'bento_shell')).toBe(true);
    expect(flags.every((flag) => flag.enabled)).toBe(true);
  });

  it('keeps flag values independent between organizations', async () => {
    expect(created, 'the bootstrap test above must have run').toHaveLength(2);

    const [first, second] = created;

    // Opt one tenant out; the other must be untouched.
    await prisma.featureFlag.update({
      where: {
        organizationId_flagKey: { organizationId: first.organizationId, flagKey: 'bento_shell' },
      },
      data: { enabled: false },
    });

    const firstFlag = await prisma.featureFlag.findUnique({
      where: {
        organizationId_flagKey: { organizationId: first.organizationId, flagKey: 'bento_shell' },
      },
    });
    const secondFlag = await prisma.featureFlag.findUnique({
      where: {
        organizationId_flagKey: { organizationId: second.organizationId, flagKey: 'bento_shell' },
      },
    });

    expect(firstFlag?.enabled).toBe(false);
    expect(secondFlag?.enabled, 'the other tenant must keep its own value').toBe(true);
  });

  it('still rejects the same key twice inside one organization', async () => {
    expect(created, 'the bootstrap test above must have run').toHaveLength(2);

    // Narrowed, not dropped: uniqueness is enforced (organizationId, flagKey).
    await expect(
      prisma.featureFlag.create({
        data: {
          organizationId: created[0].organizationId,
          flagKey: 'bento_shell',
          enabled: true,
        },
      })
    ).rejects.toThrow();

    const count = await prisma.featureFlag.count({
      where: { organizationId: created[0].organizationId, flagKey: 'bento_shell' },
    });
    expect(count).toBe(1);
  });
});
