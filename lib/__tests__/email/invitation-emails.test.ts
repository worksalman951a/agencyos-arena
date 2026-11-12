// @vitest-environment node

/**
 * Invitation e-mails (`lib/email/invitation-emails.ts`) and their sending
 * budget (`lib/email/sending-limit.ts`).
 *
 * The limiter's SQL is replaced by a scripted counter (its real behaviour is
 * covered against PostgreSQL in integration/security.integration.test.ts); the
 * key construction, the order of the budgets and the SMTP conversation are real.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTestCertificate,
  parseMessage,
  startMockSmtpServer,
  type MockSmtpServer,
  type TestCertificate,
} from './mock-smtp-server';

/** Scripted limiter store: receives (sql, key, window, max) and returns the stored count. */
const queryRaw = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: { $queryRawUnsafe: (...args: unknown[]) => queryRaw(...args) },
}));

const { sendClientInvitationEmail } = await import('@/lib/email/invitation-emails');
const { reserveInvitationEmail } = await import('@/lib/email/sending-limit');
const { RATE_LIMITS, rateLimitKey } = await import('@/lib/security/rate-limit');

const ORGANIZATION_ID = 'org_agency_a';
const RECIPIENT = 'client@example.test';
const TOKEN = 'tok_AbC-123_xyz-SECRET';
const ACCEPT_PATH = `/portal/invite/${TOKEN}`;
const EXPIRES_AT = new Date('2026-11-19T16:40:00.000Z');

const INVITATION = {
  organizationId: ORGANIZATION_ID,
  organizationName: 'Acme Agency',
  to: RECIPIENT,
  recipientName: 'Jane',
  acceptPath: ACCEPT_PATH,
  expiresAt: EXPIRES_AT,
};

let trusted: TestCertificate;
const servers: MockSmtpServer[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;

/** Make the limiter report `count` for keys of the given policy, and 1 for the rest. */
function exhaust(...policies: string[]) {
  queryRaw.mockImplementation(async (_sql: string, key: string, _window: string, max: number) => [
    {
      count: policies.some((policy) => key.startsWith(`${policy}:`)) ? max + 1 : 1,
      retry_after: 60,
    },
  ]);
}

function consumedKeys(): string[] {
  return queryRaw.mock.calls.map((call) => call[1] as string);
}

beforeAll(() => {
  trusted = createTestCertificate();
});

afterAll(() => {
  trusted.cleanup();
});

beforeEach(() => {
  // Whatever the shell exports, delivery starts switched off in every test.
  vi.stubEnv('EMAIL_TRANSPORT', '');
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  exhaust();
});

afterEach(async () => {
  queryRaw.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function enableSmtp(): Promise<MockSmtpServer> {
  const server = await startMockSmtpServer({ cert: trusted.cert, key: trusted.key });
  servers.push(server);
  const env = {
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: String(server.port),
    SMTP_USER: 'mailer-user',
    SMTP_PASS: 'smtp-password-s3cret',
    SMTP_TLS_CA_FILE: trusted.certFile,
    SMTP_TIMEOUT_MS: '3000',
    SMTP_MAX_ATTEMPTS: '1',
    EMAIL_FROM_ADDRESS: 'no-reply@example.test',
    EMAIL_FROM_NAME: 'AgencyOS',
    BETTER_AUTH_URL: 'https://app.example.test',
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return server;
}

describe('reserveInvitationEmail', () => {
  const input = { organizationId: ORGANIZATION_ID, recipient: RECIPIENT };

  it('charges the recipient, the organization and the deployment, narrowest first', async () => {
    expect(await reserveInvitationEmail(input)).toBe(true);

    expect(consumedKeys()).toEqual([
      rateLimitKey('invitation-email-recipient', `recipient:${RECIPIENT}`),
      rateLimitKey('invitation-email-organization', `organization:${ORGANIZATION_ID}`),
      rateLimitKey('invitation-email-deployment', 'deployment'),
    ]);
  });

  it('applies the published limits', async () => {
    await reserveInvitationEmail(input);

    const rules = queryRaw.mock.calls.map((call) => ({ window: call[2], max: call[3] }));
    expect(rules).toEqual([
      { window: '3600', max: 5 },
      { window: '3600', max: 30 },
      { window: '3600', max: 200 },
    ]);
    expect(RATE_LIMITS['invitation-email-recipient']).toEqual({ window: 3600, max: 5 });
    expect(RATE_LIMITS['invitation-email-organization']).toEqual({ window: 3600, max: 30 });
    expect(RATE_LIMITS['invitation-email-deployment']).toEqual({ window: 3600, max: 200 });
  });

  it('stores digests, never the address or the organization id', async () => {
    await reserveInvitationEmail(input);

    for (const key of consumedKeys()) {
      expect(key).toMatch(/^invitation-email-(recipient|organization|deployment):[0-9a-f]{32}$/);
      expect(key).not.toContain(RECIPIENT);
      expect(key).not.toContain('example.test');
      expect(key).not.toContain(ORGANIZATION_ID);
    }
  });

  it('counts one recipient once, however the address is capitalized', async () => {
    await reserveInvitationEmail(input);
    await reserveInvitationEmail({ ...input, recipient: '  Client@Example.TEST ' });

    const [first, , , second] = consumedKeys();
    expect(second).toBe(first);
  });

  it('gives every organization its own budget, and every recipient their own', async () => {
    await reserveInvitationEmail(input);
    await reserveInvitationEmail({
      organizationId: 'org_agency_b',
      recipient: 'other@example.test',
    });

    const [recipientA, organizationA, deploymentA, recipientB, organizationB, deploymentB] =
      consumedKeys();
    expect(recipientB).not.toBe(recipientA);
    expect(organizationB).not.toBe(organizationA);
    // The deployment ceiling is shared by everyone.
    expect(deploymentB).toBe(deploymentA);
  });

  it('refuses when the recipient budget is spent, without touching the wider budgets', async () => {
    exhaust('invitation-email-recipient');

    expect(await reserveInvitationEmail(input)).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses when the organization budget is spent, without touching the deployment budget', async () => {
    // An organization that is over its limit cannot use up everybody's ceiling.
    exhaust('invitation-email-organization');

    expect(await reserveInvitationEmail(input)).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('refuses when the deployment ceiling is reached', async () => {
    exhaust('invitation-email-deployment');

    expect(await reserveInvitationEmail(input)).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it('allows exactly the limit and refuses the next one', async () => {
    const counts = new Map<string, number>();
    queryRaw.mockImplementation(async (_sql: string, key: string) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return [{ count: counts.get(key), retry_after: 60 }];
    });

    const decisions: boolean[] = [];
    for (let index = 0; index < 7; index += 1) decisions.push(await reserveInvitationEmail(input));

    // Five to one recipient per hour; the sixth and seventh are refused.
    expect(decisions).toEqual([true, true, true, true, true, false, false]);
  });

  it('does not swallow a failing limiter store', async () => {
    queryRaw.mockRejectedValue(new Error('connection terminated'));

    await expect(reserveInvitationEmail(input)).rejects.toThrow('connection terminated');
  });
});

describe('sendClientInvitationEmail', () => {
  it('sends nothing, and spends no budget, while delivery is disabled', async () => {
    expect(await sendClientInvitationEmail(INVITATION)).toEqual({ status: 'disabled' });

    expect(queryRaw).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('e-mails the invitation to the invited address, with a link on the configured origin', async () => {
    const server = await enableSmtp();

    const result = await sendClientInvitationEmail(INVITATION);

    expect(result).toMatchObject({ status: 'sent', attempts: 1 });
    expect(server.messages.length).toBe(1);
    expect(server.messages[0]).toMatchObject({
      secure: true,
      authenticated: true,
      from: 'no-reply@example.test',
      to: [RECIPIENT],
    });

    const parsed = parseMessage(server.messages[0].raw);
    const link = `https://app.example.test${ACCEPT_PATH}`;
    expect(parsed.headers.to).toBe(RECIPIENT);
    expect(parsed.headers.subject).toBe('Invitation to the Acme Agency client portal');
    expect(parsed.text).toContain('Hello Jane,');
    expect(parsed.text).toContain(link);
    expect(parsed.text).toContain('expires on 19 November 2026 at 16:40 UTC');
    expect(parsed.html).toContain(`href="${link}"`);
    expect(parsed.text.match(/https?:\/\/[^\s"<]+/g)).toEqual([link]);
  });

  it('spends the budget of the inviting organization and of the recipient', async () => {
    await enableSmtp();

    await sendClientInvitationEmail(INVITATION);

    expect(consumedKeys()).toEqual([
      rateLimitKey('invitation-email-recipient', `recipient:${RECIPIENT}`),
      rateLimitKey('invitation-email-organization', `organization:${ORGANIZATION_ID}`),
      rateLimitKey('invitation-email-deployment', 'deployment'),
    ]);
  });

  it.each([
    'invitation-email-recipient',
    'invitation-email-organization',
    'invitation-email-deployment',
  ])('does not connect when the %s budget is spent, and says so', async (policy) => {
    const server = await enableSmtp();
    exhaust(policy);

    expect(await sendClientInvitationEmail(INVITATION)).toEqual({
      status: 'failed',
      reason: 'rate_limited',
      attempts: 0,
    });
    expect(server.connections).toBe(0);
    // The log names the limit that was reached - and nobody.
    expect(consoleError.mock.calls).toEqual([
      ['[email] invitation e-mail limit reached; the message was not sent', { policy }],
    ]);
  });

  it('does not connect when the limiter store is unavailable (fails closed)', async () => {
    const server = await enableSmtp();
    queryRaw.mockRejectedValue(new Error('connection terminated'));

    expect(await sendClientInvitationEmail(INVITATION)).toEqual({
      status: 'failed',
      reason: 'unknown',
      attempts: 0,
    });
    expect(server.connections).toBe(0);
  });

  it('keeps the token out of the result and out of the log', async () => {
    const server = await enableSmtp();

    const sent = await sendClientInvitationEmail(INVITATION);

    exhaust('invitation-email-organization');
    const limited = await sendClientInvitationEmail(INVITATION);

    exhaust();
    await server.close();
    servers.length = 0;
    const unreachable = await sendClientInvitationEmail(INVITATION);

    expect(sent.status).toBe('sent');
    expect(limited).toMatchObject({ status: 'failed', reason: 'rate_limited' });
    expect(unreachable).toMatchObject({ status: 'failed', reason: 'connection' });
    expect(consoleError).toHaveBeenCalledTimes(2);

    const everything = JSON.stringify([sent, limited, unreachable, consoleError.mock.calls]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(RECIPIENT);
    expect(everything).not.toContain('Acme Agency');
  });

  it('cannot be steered to another recipient by a hostile organization or contact name', async () => {
    const server = await enableSmtp();

    const result = await sendClientInvitationEmail({
      ...INVITATION,
      organizationName: 'Acme\r\nBcc: attacker@evil.example\r\n\r\n<script>alert(1)</script>',
      recipientName: 'Jane\r\nTo: attacker@evil.example',
    });

    expect(result.status).toBe('sent');
    expect(server.messages[0].to).toEqual([RECIPIENT]);

    const { raw } = server.messages[0];
    const parsed = parseMessage(raw);
    expect(parsed.headers.bcc).toBeUndefined();
    expect(parsed.headers.to).toBe(RECIPIENT);
    expect(raw.split('\r\n\r\n')[0]).not.toMatch(/^(Bcc|Cc):/im);
    expect(parsed.html).not.toContain('<script>');
    expect(parsed.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it.each([
    ['a recipient list', `${RECIPIENT},attacker@evil.example`],
    ['a recipient with a line break', `${RECIPIENT}\r\nBcc: attacker@evil.example`],
  ])('refuses %s without spending budget or connecting', async (_label, to) => {
    const server = await enableSmtp();

    expect(await sendClientInvitationEmail({ ...INVITATION, to })).toEqual({
      status: 'failed',
      reason: 'invalid_message',
      attempts: 0,
    });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(server.connections).toBe(0);
  });

  it.each([
    ['another site', '//evil.example/portal/invite/token'],
    ['a path with a query string', `${ACCEPT_PATH}?next=//evil.example`],
  ])('refuses an acceptance path that points at %s', async (_label, acceptPath) => {
    const server = await enableSmtp();

    expect(await sendClientInvitationEmail({ ...INVITATION, acceptPath })).toMatchObject({
      status: 'failed',
      reason: 'invalid_message',
    });
    expect(server.connections).toBe(0);
  });
});
