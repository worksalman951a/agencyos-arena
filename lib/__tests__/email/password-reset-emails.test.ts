// @vitest-environment node

/**
 * Password-reset e-mail (`lib/email/password-reset-emails.ts`) and its sending
 * budget (`lib/email/sending-limit.ts`).
 *
 * The limiter's SQL is replaced with a scripted counter (its real PostgreSQL
 * behaviour is covered in integration/security.integration.test.ts); the SMTP
 * conversation and message rendering are real, against the loopback server in
 * `mock-smtp-server.ts`. Nothing leaves the process.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTestCertificate,
  parseMessage,
  startMockSmtpServer,
  type MockSmtpServer,
  type TestCertificate,
} from './mock-smtp-server';

/** Scripted limiter store: (sql, key, window, max) -> stored count. */
const queryRaw = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: { $queryRawUnsafe: (...args: unknown[]) => queryRaw(...args) },
}));

const { sendPasswordResetEmail } = await import('@/lib/email/password-reset-emails');
const { reservePasswordResetEmail } = await import('@/lib/email/sending-limit');
const { RATE_LIMITS, rateLimitKey } = await import('@/lib/security/rate-limit');

const RECIPIENT = 'person@example.test';
const TOKEN = 'tok_AbC-123_xyz-SECRET';
const RESET_PATH = `/reset-password/${TOKEN}`;
const RESET_URL = `https://app.example.test${RESET_PATH}`;
const EXPIRES_AT = new Date('2026-11-12T18:40:00.000Z');

let trusted: TestCertificate;
const servers: MockSmtpServer[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleOther: Array<ReturnType<typeof vi.spyOn>>;

beforeAll(() => {
  trusted = createTestCertificate();
});

afterAll(() => {
  trusted.cleanup();
});

beforeEach(() => {
  // Delivery starts switched off no matter what the developer's shell exports.
  vi.stubEnv('EMAIL_TRANSPORT', '');
  queryRaw.mockResolvedValue([{ count: 1, retry_after: 0 }]);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleOther = (['log', 'info', 'warn', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined)
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function startServer(): Promise<MockSmtpServer> {
  const server = await startMockSmtpServer({ cert: trusted.cert, key: trusted.key });
  servers.push(server);
  return server;
}

function smtpEnv(server: { port: number }, overrides: Record<string, string | undefined> = {}) {
  return {
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: String(server.port),
    SMTP_TLS_CA_FILE: trusted.certFile,
    SMTP_TIMEOUT_MS: '3000',
    SMTP_MAX_ATTEMPTS: '1',
    EMAIL_FROM_ADDRESS: 'no-reply@example.test',
    EMAIL_FROM_NAME: 'AgencyOS',
    BETTER_AUTH_URL: 'https://app.example.test',
    ...overrides,
  };
}

function stub(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value ?? '');
}

function send() {
  return sendPasswordResetEmail({ to: RECIPIENT, resetPath: RESET_PATH, expiresAt: EXPIRES_AT });
}

function consumedKeys(): string[] {
  return queryRaw.mock.calls.map((call) => call[1] as string);
}

function consoleOutput(): string {
  return JSON.stringify([consoleError, ...consoleOther].flatMap((spy) => spy.mock.calls));
}

describe('sendPasswordResetEmail', () => {
  it('sends nothing while delivery is disabled and never charges a budget', async () => {
    const server = await startServer();

    const result = await send();

    expect(result.status).toBe('disabled');
    expect(server.messages).toHaveLength(0);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(consoleOutput()).not.toContain(TOKEN);
    expect(consoleOutput()).not.toContain(RECIPIENT);
  });

  it('sends nothing when delivery is enabled but misconfigured', async () => {
    vi.stubEnv('EMAIL_TRANSPORT', 'smtp');

    const result = await send();

    expect(result).toEqual({ status: 'failed', reason: 'configuration', attempts: 0 });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('sends a text and HTML message with exactly the reset link', async () => {
    const server = await startServer();
    stub(smtpEnv(server));

    const result = await send();

    expect(result.status).toBe('sent');
    expect(server.messages).toHaveLength(1);

    const message = parseMessage(server.messages[0].raw);
    expect(server.messages[0].to).toEqual([RECIPIENT]);
    expect(message.headers.subject).toBe('Reset your AgencyOS password');
    expect(message.text).toContain(RESET_URL);
    expect(message.text).toContain('This link expires on 12 November 2026 at 18:40 UTC.');
    expect(message.html).toContain(RESET_URL);
    expect(message.html).toContain('Reset password');
    expect(message.partTypes).toEqual(expect.arrayContaining(['text/plain', 'text/html']));
    expect((message.text.match(/https?:\/\/\S+/g) ?? []).length).toBe(1);
  });

  it('charges the recipient and deployment budgets, narrowest first, by digest', async () => {
    const server = await startServer();
    stub(smtpEnv(server));

    await send();

    expect(consumedKeys()).toEqual([
      rateLimitKey('password-reset-email-recipient', `recipient:${RECIPIENT}`),
      rateLimitKey('password-reset-email-deployment', 'deployment'),
    ]);
    for (const key of consumedKeys()) {
      expect(key).not.toContain(RECIPIENT);
      expect(key).not.toContain(TOKEN);
    }
  });

  it('sends nothing when the recipient budget is exhausted', async () => {
    const server = await startServer();
    stub(smtpEnv(server));
    queryRaw.mockResolvedValue([
      { count: RATE_LIMITS['password-reset-email-recipient'].max + 1, retry_after: 600 },
    ]);

    const result = await send();

    expect(result).toEqual({ status: 'failed', reason: 'rate_limited', attempts: 0 });
    expect(server.messages).toHaveLength(0);
  });

  it('reports an unreachable relay as failed and logs no recipient or token', async () => {
    const server = await startServer();
    const closedPort = server.port;
    await server.close();
    servers.splice(0, 1);

    stub(smtpEnv({ port: closedPort }));

    const result = await send();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(['connection', 'unknown']).toContain(result.reason);
    const output = consoleOutput();
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(RECIPIENT);
    expect(output).not.toContain('example.test');
  });
});

describe('reservePasswordResetEmail', () => {
  it('reports false on the first exhausted budget without spending the wider one', async () => {
    queryRaw.mockResolvedValue([
      { count: RATE_LIMITS['password-reset-email-recipient'].max + 1, retry_after: 600 },
    ]);

    await expect(reservePasswordResetEmail({ recipient: RECIPIENT })).resolves.toBe(false);
    expect(consumedKeys()).toEqual([
      rateLimitKey('password-reset-email-recipient', `recipient:${RECIPIENT}`),
    ]);
  });

  it('reports true when both budgets have room', async () => {
    await expect(reservePasswordResetEmail({ recipient: ' Person@Example.Test ' })).resolves.toBe(
      true
    );
    expect(consumedKeys()).toEqual([
      rateLimitKey('password-reset-email-recipient', 'recipient:person@example.test'),
      rateLimitKey('password-reset-email-deployment', 'deployment'),
    ]);
  });
});
