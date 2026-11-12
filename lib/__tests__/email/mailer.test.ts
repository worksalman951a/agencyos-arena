// @vitest-environment node

/**
 * The mailer (`lib/email/mailer.ts`): when a message is sent, when it is not,
 * how often it is retried and what is reported about it.
 *
 * `deliverWithRetry` is exercised with scripted in-memory transports;
 * `sendEmail` is exercised end to end, from environment variables to the bytes
 * an SMTP server receives, against the loopback server in `mock-smtp-server.ts`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { deliverWithRetry, sendEmail, type ComposeEmail } from '@/lib/email/mailer';
import type {
  DeliveryAttempt,
  EmailMessage,
  EmailTransport,
  OutgoingEmail,
} from '@/lib/email/types';

import {
  HANG,
  createTestCertificate,
  parseMessage,
  startMockSmtpServer,
  type MockSmtpOptions,
  type MockSmtpServer,
  type TestCertificate,
} from './mock-smtp-server';

const USER = 'mailer-user';
const PASSWORD = 'smtp-password-s3cret';
const RECIPIENT = 'client@example.test';
const ATTACKER = 'attacker@evil.example';
const TOKEN = 'tok_AbC-123_xyz-SECRET';
const ACCEPT_PATH = `/portal/invite/${TOKEN}`;
const SUBJECT = 'Invitation to the Acme Agency client portal';
const SERVER_TEXT = 'SERVER-INTERNAL-DETAIL';

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
  // Whatever the developer's shell exports, a test that falls back to
  // process.env must find delivery switched off: no test may send real e-mail.
  vi.stubEnv('EMAIL_TRANSPORT', '');
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

async function startServer(options: Partial<MockSmtpOptions> = {}): Promise<MockSmtpServer> {
  const server = await startMockSmtpServer({ cert: trusted.cert, key: trusted.key, ...options });
  servers.push(server);
  return server;
}

function smtpEnv(server: { port: number }, overrides: Record<string, string | undefined> = {}) {
  return {
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: String(server.port),
    SMTP_USER: USER,
    SMTP_PASS: PASSWORD,
    SMTP_TLS_CA_FILE: trusted.certFile,
    SMTP_TIMEOUT_MS: '3000',
    EMAIL_FROM_ADDRESS: 'no-reply@example.test',
    EMAIL_FROM_NAME: 'Acme Portal',
    EMAIL_REPLY_TO: 'support@example.test',
    BETTER_AUTH_URL: 'https://app.example.test',
    ...overrides,
  };
}

function composeInvitation(overrides: Partial<EmailMessage> = {}): ComposeEmail {
  return (link) => {
    const url = link(ACCEPT_PATH);
    return {
      to: RECIPIENT,
      subject: SUBJECT,
      text: `Hello Jane,\n\nAccept invitation:\n${url}\n`,
      html: `<!doctype html><html lang="en"><body><a href="${url}">Accept invitation</a></body></html>`,
      ...overrides,
    };
  };
}

/** Everything written to the console during the test, as one searchable string. */
function consoleOutput(): string {
  return JSON.stringify([consoleError, ...consoleOther].flatMap((spy) => spy.mock.calls));
}

function expectNothingSensitiveLogged() {
  const output = consoleOutput();
  for (const secret of [TOKEN, ACCEPT_PATH, RECIPIENT, SUBJECT, PASSWORD, USER, SERVER_TEXT]) {
    expect(output).not.toContain(secret);
  }
  expect(output).not.toContain('example.test');
}

/* -------------------------------------------------------------------------- */

describe('deliverWithRetry', () => {
  const MESSAGE: OutgoingEmail = {
    to: RECIPIENT,
    from: { name: 'Acme Portal', address: 'no-reply@example.test' },
    subject: SUBJECT,
    text: 'text',
    html: '<p>html</p>',
    messageId: '<11111111-2222-3333-4444-555555555555@example.test>',
  };

  const ACCEPTED: DeliveryAttempt = { accepted: true };
  const retryable = (reason: 'connection' | 'rejected' = 'connection'): DeliveryAttempt => ({
    accepted: false,
    reason,
    retryable: true,
    diagnostics: { code: 'ESOCKET', cause: 'ECONNREFUSED' },
  });
  const final = (reason: 'rejected' | 'authentication' | 'tls' = 'rejected'): DeliveryAttempt => ({
    accepted: false,
    reason,
    retryable: false,
    diagnostics: { code: 'EENVELOPE', smtpStatus: 550, command: 'RCPT TO' },
  });

  /** A transport that answers with the scripted outcomes, in order. */
  function scripted(...outcomes: DeliveryAttempt[]) {
    const calls: Array<{ message: OutgoingEmail; at: number }> = [];
    const transport: EmailTransport = {
      deliver: async (message) => {
        calls.push({ message, at: Date.now() });
        return outcomes[Math.min(calls.length, outcomes.length) - 1];
      },
    };
    return { transport, calls };
  }

  const policy = (overrides = {}) => ({
    maxAttempts: 3,
    retryDelayMs: 5,
    attemptTimeoutMs: 1000,
    ...overrides,
  });

  it('reports a message the transport accepted as sent, after one attempt', async () => {
    const { transport, calls } = scripted(ACCEPTED);

    expect(await deliverWithRetry(transport, MESSAGE, policy())).toEqual({
      status: 'sent',
      messageId: MESSAGE.messageId,
      attempts: 1,
    });
    expect(calls.length).toBe(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('retries a retryable failure and reports the eventual success', async () => {
    const { transport, calls } = scripted(retryable(), ACCEPTED);

    expect(await deliverWithRetry(transport, MESSAGE, policy())).toEqual({
      status: 'sent',
      messageId: MESSAGE.messageId,
      attempts: 2,
    });
    expect(calls.length).toBe(2);
  });

  it('sends the same message, with the same Message-ID, on every attempt', async () => {
    const { transport, calls } = scripted(retryable(), retryable(), ACCEPTED);

    await deliverWithRetry(transport, MESSAGE, policy());

    expect(calls.map((call) => call.message.messageId)).toEqual(
      Array.from({ length: 3 }, () => MESSAGE.messageId)
    );
    for (const call of calls) expect(call.message).toEqual(MESSAGE);
  });

  it.each([1, 2, 3])('stops after %i attempt(s) and reports the failure', async (maxAttempts) => {
    const { transport, calls } = scripted(retryable('rejected'));

    expect(await deliverWithRetry(transport, MESSAGE, policy({ maxAttempts }))).toEqual({
      status: 'failed',
      reason: 'rejected',
      attempts: maxAttempts,
    });
    expect(calls.length).toBe(maxAttempts);
  });

  it.each(['rejected', 'authentication', 'tls'] as const)(
    'never retries a final %s failure',
    async (reason) => {
      const { transport, calls } = scripted(final(reason), ACCEPTED);

      expect(await deliverWithRetry(transport, MESSAGE, policy())).toEqual({
        status: 'failed',
        reason,
        attempts: 1,
      });
      expect(calls.length).toBe(1);
    }
  );

  it('waits between attempts, doubling the delay', async () => {
    const { transport, calls } = scripted(retryable(), retryable(), ACCEPTED);

    await deliverWithRetry(transport, MESSAGE, policy({ retryDelayMs: 60 }));

    const [first, second, third] = calls.map((call) => call.at);
    expect(second - first).toBeGreaterThanOrEqual(55);
    expect(third - second).toBeGreaterThanOrEqual(115);
  });

  it('releases the caller when a transport never answers, and does not retry', async () => {
    const signals: AbortSignal[] = [];
    const transport: EmailTransport = {
      deliver: (_message, signal) => {
        signals.push(signal);
        return new Promise<DeliveryAttempt>(() => undefined);
      },
    };
    const startedAt = Date.now();

    const result = await deliverWithRetry(transport, MESSAGE, policy({ attemptTimeoutMs: 80 }));

    // How far the attempt got is unknown, so a second one could duplicate it.
    expect(result).toEqual({ status: 'failed', reason: 'timeout', attempts: 1 });
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(true);
  });

  it('does not report "sent" for an answer that arrives after the deadline', async () => {
    const transport: EmailTransport = {
      deliver: () => new Promise((resolve) => setTimeout(() => resolve(ACCEPTED), 200)),
    };

    const result = await deliverWithRetry(transport, MESSAGE, policy({ attemptTimeoutMs: 50 }));

    expect(result).toEqual({ status: 'failed', reason: 'timeout', attempts: 1 });
  });

  it.each([
    ['rejects', () => Promise.reject(new Error(`boom ${TOKEN}`))],
    [
      'throws',
      () => {
        throw new Error(`boom ${TOKEN}`);
      },
    ],
  ] as Array<[string, EmailTransport['deliver']]>)(
    'contains a transport that %s, without retrying and without logging its message',
    async (_label, deliver) => {
      const spy = vi.fn(deliver);

      const result = await deliverWithRetry({ deliver: spy }, MESSAGE, policy());

      expect(result).toEqual({ status: 'failed', reason: 'unknown', attempts: 1 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(consoleOutput()).not.toContain(TOKEN);
    }
  );

  it('logs a failure once, with the reason and codes only', async () => {
    const { transport } = scripted(retryable(), final());

    await deliverWithRetry(transport, MESSAGE, policy());

    expect(consoleError.mock.calls).toEqual([
      [
        '[email] delivery failed; nothing is recorded as sent',
        { reason: 'rejected', attempts: 2, code: 'EENVELOPE', smtpStatus: 550, command: 'RCPT TO' },
      ],
    ]);
    expectNothingSensitiveLogged();
  });
});

/* -------------------------------------------------------------------------- */

describe('sendEmail: delivery is off unless it is switched on', () => {
  it('reports "disabled" - not "sent" - when nothing is configured', async () => {
    const compose = vi.fn(composeInvitation());
    const reserve = vi.fn(async () => true);

    expect(await sendEmail(compose, { env: {}, reserve })).toEqual({ status: 'disabled' });

    // No message is rendered, so the link and its token never exist in memory
    // outside the caller, and no sending budget is spent.
    expect(compose).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('does not connect when SMTP settings exist but the transport is not selected', async () => {
    const server = await startServer();

    for (const EMAIL_TRANSPORT of [undefined, '', 'disabled']) {
      expect(
        await sendEmail(composeInvitation(), { env: smtpEnv(server, { EMAIL_TRANSPORT }) })
      ).toEqual({ status: 'disabled' });
    }
    expect(server.connections).toBe(0);
  });

  it('reads process.env by default', async () => {
    const server = await startServer();

    expect(await sendEmail(composeInvitation())).toEqual({ status: 'disabled' });

    for (const [name, value] of Object.entries(smtpEnv(server))) vi.stubEnv(name, value);
    expect((await sendEmail(composeInvitation())).status).toBe('sent');
    expect(server.messages.length).toBe(1);
  });
});

describe('sendEmail: a broken configuration sends nothing', () => {
  it('reports a configuration failure without composing or connecting', async () => {
    const server = await startServer();
    const compose = vi.fn(composeInvitation());
    const reserve = vi.fn(async () => true);

    const result = await sendEmail(compose, {
      env: smtpEnv(server, { SMTP_PASS: undefined, BETTER_AUTH_URL: 'http://app.example.test' }),
      reserve,
    });

    expect(result).toEqual({ status: 'failed', reason: 'configuration', attempts: 0 });
    expect(compose).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(server.connections).toBe(0);
  });

  it('logs which variables are wrong, never their values', async () => {
    const server = await startServer();

    await sendEmail(composeInvitation(), {
      env: smtpEnv(server, { SMTP_PASS: `${PASSWORD}\n`, EMAIL_FROM_ADDRESS: 'not-an-address' }),
    });

    expect(consoleError.mock.calls).toEqual([
      [
        '[email] delivery is enabled but misconfigured; nothing was sent',
        {
          problems: [
            'SMTP_USER and SMTP_PASS must not contain line breaks or control characters',
            'EMAIL_FROM_ADDRESS is missing or is not a valid e-mail address',
          ],
        },
      ],
    ]);
    expectNothingSensitiveLogged();
  });
});

describe('sendEmail: end to end over SMTP', () => {
  it('sends the composed message to exactly the composed recipient', async () => {
    const server = await startServer();

    const result = await sendEmail(composeInvitation(), { env: smtpEnv(server) });

    expect(result).toEqual({
      status: 'sent',
      messageId: expect.stringMatching(/^<[0-9a-f-]{36}@example\.test>$/),
      attempts: 1,
    });
    expect(server.connections).toBe(1);
    expect(server.messages.length).toBe(1);

    const [message] = server.messages;
    expect(message).toMatchObject({
      secure: true,
      authenticated: true,
      from: 'no-reply@example.test',
      to: [RECIPIENT],
    });

    const parsed = parseMessage(message.raw);
    expect(parsed.headers.from).toBe('Acme Portal <no-reply@example.test>');
    expect(parsed.headers.to).toBe(RECIPIENT);
    expect(parsed.headers['reply-to']).toBe('support@example.test');
    expect(parsed.headers.subject).toBe(SUBJECT);
    expect(parsed.headers['message-id']).toBe(
      result.status === 'sent' ? result.messageId : undefined
    );
    expect(parsed.partTypes).toEqual(['text/plain', 'text/html']);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('builds the link on the configured origin', async () => {
    const server = await startServer();

    await sendEmail(composeInvitation(), {
      env: smtpEnv(server, { BETTER_AUTH_URL: 'https://portal.acme.example/ignored/path' }),
    });

    const parsed = parseMessage(server.messages[0].raw);
    const expected = `https://portal.acme.example${ACCEPT_PATH}`;
    expect(parsed.text).toContain(expected);
    expect(parsed.html).toContain(`href="${expected}"`);
    expect(parsed.text.match(/https?:\/\/[^\s"<]+/g)).toEqual([expected]);
  });

  it('uses a fresh Message-ID for every message', async () => {
    const server = await startServer();

    const first = await sendEmail(composeInvitation(), { env: smtpEnv(server) });
    const second = await sendEmail(composeInvitation(), { env: smtpEnv(server) });

    expect(first.status).toBe('sent');
    expect(second.status).toBe('sent');
    expect(first).not.toEqual(second);
  });

  it('ignores anything in the composed message beyond its four fields', async () => {
    const server = await startServer();
    const smuggled = {
      bcc: ATTACKER,
      cc: ATTACKER,
      from: ATTACKER,
      replyTo: ATTACKER,
      envelope: { from: ATTACKER, to: [ATTACKER] },
      headers: { Bcc: ATTACKER },
      attachments: [{ path: '/etc/passwd' }],
    } as unknown as Partial<EmailMessage>;

    const result = await sendEmail(composeInvitation(smuggled), { env: smtpEnv(server) });

    expect(result.status).toBe('sent');
    expect(server.messages[0].from).toBe('no-reply@example.test');
    expect(server.messages[0].to).toEqual([RECIPIENT]);
    expect(server.messages[0].raw).not.toContain(ATTACKER);
    expect(parseMessage(server.messages[0].raw).partTypes).toEqual(['text/plain', 'text/html']);
  });
});

describe('sendEmail: links can only point at the application', () => {
  it.each([
    ['a protocol-relative URL', '//evil.example/portal/invite/token'],
    ['an absolute URL', 'https://evil.example/portal/invite/token'],
    ['a path without a leading slash', 'portal/invite/token'],
    ['a user-info trick', '/@evil.example/'],
    ['a query string', '/portal/invite/token?next=https://evil.example'],
    ['a fragment', '/portal/invite/token#x'],
    ['parent segments', '/portal/../admin'],
    ['a backslash', '/\\evil.example'],
    ['an encoded slash', '/portal/invite/%2f%2fevil.example'],
    ['whitespace', '/portal/invite/to ken'],
    ['a line break', '/portal/invite/token\r\nBcc: attacker@evil.example'],
    ['an empty segment', '/portal//invite'],
    ['a trailing slash', '/portal/invite/'],
    ['the empty string', ''],
  ])('refuses %s and sends nothing', async (_label, path) => {
    const server = await startServer();
    const compose: ComposeEmail = (link) => ({
      to: RECIPIENT,
      subject: SUBJECT,
      text: link(path),
      html: `<a href="${link(path)}">x</a>`,
    });

    expect(await sendEmail(compose, { env: smtpEnv(server) })).toEqual({
      status: 'failed',
      reason: 'invalid_message',
      attempts: 0,
    });
    expect(server.connections).toBe(0);
  });
});

describe('sendEmail: an invalid message is refused before anything is sent', () => {
  it.each([
    ['a recipient list', { to: `${RECIPIENT},${ATTACKER}` }],
    ['a recipient with a line break', { to: `${RECIPIENT}\r\nBcc: ${ATTACKER}` }],
    ['a recipient with a display name', { to: `Client <${RECIPIENT}>` }],
    ['an empty recipient', { to: '' }],
    ['a recipient that is not a string', { to: [RECIPIENT] as unknown as string }],
    ['a subject with a line break', { subject: `Hello\r\nBcc: ${ATTACKER}` }],
    ['an empty subject', { subject: '   ' }],
    ['an over-long subject', { subject: 'S'.repeat(256) }],
    ['an empty text alternative', { text: '  ' }],
    ['an empty HTML alternative', { html: '' }],
    ['a missing HTML alternative', { html: undefined as unknown as string }],
  ] as Array<[string, Partial<EmailMessage>]>)('refuses %s', async (_label, override) => {
    const server = await startServer();
    const reserve = vi.fn(async () => true);

    const result = await sendEmail(composeInvitation(override), { env: smtpEnv(server), reserve });

    expect(result).toEqual({ status: 'failed', reason: 'invalid_message', attempts: 0 });
    expect(reserve).not.toHaveBeenCalled();
    expect(server.connections).toBe(0);
    expectNothingSensitiveLogged();
  });

  it.each([null, undefined, 'a string', 42])('refuses a composed %j', async (value) => {
    const server = await startServer();

    const result = await sendEmail(() => value as unknown as EmailMessage, {
      env: smtpEnv(server),
    });

    expect(result).toEqual({ status: 'failed', reason: 'invalid_message', attempts: 0 });
    expect(server.connections).toBe(0);
  });

  it('contains a compose function that throws, without logging its error', async () => {
    const server = await startServer();

    const result = await sendEmail(
      () => {
        throw new Error(`could not render ${ACCEPT_PATH} for ${RECIPIENT}`);
      },
      { env: smtpEnv(server) }
    );

    expect(result).toEqual({ status: 'failed', reason: 'invalid_message', attempts: 0 });
    expect(server.connections).toBe(0);
    expectNothingSensitiveLogged();
  });
});

describe('sendEmail: the sending budget', () => {
  it('is asked once, after validation and before the server is contacted', async () => {
    const server = await startServer();
    const connectionsWhenAsked: number[] = [];
    const reserve = vi.fn(async () => {
      connectionsWhenAsked.push(server.connections);
      return true;
    });

    const result = await sendEmail(composeInvitation(), { env: smtpEnv(server), reserve });

    expect(result.status).toBe('sent');
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(connectionsWhenAsked).toEqual([0]);
  });

  it('is not asked again for a retry of the same message', async () => {
    const server = await startServer({
      script: (step, session) =>
        step === 'rcpt' && session.connection === 1 ? '450 4.2.1 Try again' : undefined,
    });
    const reserve = vi.fn(async () => true);

    const result = await sendEmail(composeInvitation(), { env: smtpEnv(server), reserve });

    expect(result).toMatchObject({ status: 'sent', attempts: 2 });
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the budget is exhausted, and says so', async () => {
    const server = await startServer();

    const result = await sendEmail(composeInvitation(), {
      env: smtpEnv(server),
      reserve: async () => false,
    });

    expect(result).toEqual({ status: 'failed', reason: 'rate_limited', attempts: 0 });
    expect(server.connections).toBe(0);
    // The budget reports which limit was reached; the mailer adds nothing.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('sends nothing when the budget cannot be checked (fails closed)', async () => {
    const server = await startServer();

    const result = await sendEmail(composeInvitation(), {
      env: smtpEnv(server),
      reserve: async () => {
        throw new Error(`limiter store unavailable for ${RECIPIENT}`);
      },
    });

    expect(result).toEqual({ status: 'failed', reason: 'unknown', attempts: 0 });
    expect(server.connections).toBe(0);
    expect(consoleError.mock.calls).toEqual([
      ['[email] unexpected failure; the message is not recorded as sent', { errorName: 'Error' }],
    ]);
    expectNothingSensitiveLogged();
  });
});

describe('sendEmail: failures, retries and what is reported', () => {
  it('retries a temporary refusal on a new connection and reports the success', async () => {
    const server = await startServer({
      script: (step, session) =>
        step === 'rcpt' && session.connection === 1 ? '450 4.2.1 Mailbox busy' : undefined,
    });

    const result = await sendEmail(composeInvitation(), { env: smtpEnv(server) });

    expect(result).toMatchObject({ status: 'sent', attempts: 2 });
    expect(server.connections).toBe(2);
    expect(server.messages.length).toBe(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('repeats the same Message-ID when it retries, so a relay can spot a duplicate', async () => {
    const server = await startServer({
      script: (step, session) =>
        step === 'message' && session.connection === 1 ? '451 4.3.0 Try again later' : undefined,
    });

    const result = await sendEmail(composeInvitation(), { env: smtpEnv(server) });

    expect(result).toMatchObject({ status: 'sent', attempts: 2 });
    const ids = server.messages.map((message) => parseMessage(message.raw).headers['message-id']);
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(result.status === 'sent' ? result.messageId : undefined);
  });

  it('gives up after the configured number of attempts', async () => {
    const server = await startServer({
      script: (step) => (step === 'rcpt' ? `450 4.2.1 <${RECIPIENT}> ${SERVER_TEXT}` : undefined),
    });

    const result = await sendEmail(composeInvitation(), { env: smtpEnv(server) });

    expect(result).toEqual({ status: 'failed', reason: 'rejected', attempts: 2 });
    expect(server.connections).toBe(2);
    expect(server.messages.length).toBe(0);
    expect(consoleError.mock.calls).toEqual([
      [
        '[email] delivery failed; nothing is recorded as sent',
        { reason: 'rejected', attempts: 2, code: 'EENVELOPE', smtpStatus: 450, command: 'RCPT TO' },
      ],
    ]);
    expectNothingSensitiveLogged();
  });

  it('makes a single attempt when SMTP_MAX_ATTEMPTS=1', async () => {
    const server = await startServer({
      script: (step) => (step === 'rcpt' ? '450 4.2.1 Mailbox busy' : undefined),
    });

    const result = await sendEmail(composeInvitation(), {
      env: smtpEnv(server, { SMTP_MAX_ATTEMPTS: '1' }),
    });

    expect(result).toEqual({ status: 'failed', reason: 'rejected', attempts: 1 });
    expect(server.connections).toBe(1);
  });

  it.each([
    ['a permanent rejection', 'rcpt', `550 5.1.1 <${RECIPIENT}> ${SERVER_TEXT}`, 'rejected'],
    ['refused credentials', 'auth', `535 5.7.8 ${SERVER_TEXT} ${USER}`, 'authentication'],
  ] as const)('does not retry %s', async (_label, step, reply, reason) => {
    const server = await startServer({ script: (at) => (at === step ? reply : undefined) });

    const result = await sendEmail(composeInvitation(), { env: smtpEnv(server) });

    expect(result).toEqual({ status: 'failed', reason, attempts: 1 });
    expect(server.connections).toBe(1);
    expectNothingSensitiveLogged();
  });

  it('does not retry - and does not claim success - when the outcome is unknown', async () => {
    // The body was transmitted and the server went silent: it may or may not
    // have queued the message. Reported as a failure, never re-sent.
    const server = await startServer({ script: (step) => (step === 'message' ? HANG : undefined) });
    const startedAt = Date.now();

    const result = await sendEmail(composeInvitation(), {
      env: smtpEnv(server, { SMTP_TIMEOUT_MS: '1000' }),
    });

    expect(result).toEqual({ status: 'failed', reason: 'timeout', attempts: 1 });
    expect(server.connections).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(4000);
  });

  it('refuses an untrusted server certificate and reports a TLS failure', async () => {
    const stranger = createTestCertificate();
    try {
      const server = await startServer({ cert: stranger.cert, key: stranger.key });

      const result = await sendEmail(composeInvitation(), { env: smtpEnv(server) });

      expect(result).toEqual({ status: 'failed', reason: 'tls', attempts: 1 });
      expect(server.sessions.every((session) => session.auth === undefined)).toBe(true);
      expect(server.messages.length).toBe(0);
    } finally {
      stranger.cleanup();
    }
  });

  it('retries a connection that is refused, then reports the failure', async () => {
    const server = await startServer();
    const env = smtpEnv(server);
    await server.close();
    servers.length = 0;

    expect(await sendEmail(composeInvitation(), { env })).toEqual({
      status: 'failed',
      reason: 'connection',
      attempts: 2,
    });
  });

  it('never throws, whatever goes wrong', async () => {
    const server = await startServer({ script: () => '500 5.5.1 no' });
    const hostile = [
      () => sendEmail(composeInvitation(), { env: smtpEnv(server) }),
      () => sendEmail(composeInvitation(), { env: { EMAIL_TRANSPORT: 'smtp' } }),
      () => sendEmail(undefined as unknown as ComposeEmail, { env: smtpEnv(server) }),
      () => sendEmail(composeInvitation(), { env: null as unknown as Record<string, string> }),
    ];

    for (const attempt of hostile) {
      const result = await attempt();
      expect(result.status).not.toBe('sent');
    }
  });
});
