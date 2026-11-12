// @vitest-environment node

/**
 * The SMTP transport (`lib/email/smtp-transport.ts`) against a real SMTP
 * conversation.
 *
 * Every test talks to an in-process server on a loopback socket through real
 * TCP and real TLS (`mock-smtp-server.ts`), so what is asserted is what a mail
 * server would observe: whether TLS was up before the credentials arrived, who
 * the envelope recipient was, and what the message looked like on the wire.
 * Nothing leaves the process and no real e-mail can be sent.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SmtpSettings } from '@/lib/email/config';
import { classifySmtpError, createSmtpTransport } from '@/lib/email/smtp-transport';
import type { DeliveryAttempt, OutgoingEmail } from '@/lib/email/types';

import {
  DROP,
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
const LINK = 'https://app.example.test/portal/invite/tok_AbC-123_xyz';

const MESSAGE: OutgoingEmail = {
  to: RECIPIENT,
  from: { name: 'Acme Portal', address: 'no-reply@example.test' },
  replyTo: 'support@example.test',
  subject: 'Invitation to the Acme Agency client portal',
  text: `Hello Jane,\n\nAccept invitation:\n${LINK}\n`,
  html: `<!doctype html><html lang="en"><body><p>Hello Jane,</p><a href="${LINK}">Accept invitation</a></body></html>`,
  messageId: '<11111111-2222-3333-4444-555555555555@example.test>',
};

/** Trusted by the client and valid for `localhost`. */
let trusted: TestCertificate;
/** A different self-signed certificate the client has never heard of. */
let unknown: TestCertificate;
/** Trusted by the client, but issued for another host name. */
let otherHost: TestCertificate;

const servers: MockSmtpServer[] = [];

beforeAll(() => {
  trusted = createTestCertificate();
  unknown = createTestCertificate();
  otherHost = createTestCertificate({
    commonName: 'mail.elsewhere.test',
    subjectAltName: 'DNS:mail.elsewhere.test',
  });
});

afterAll(() => {
  trusted.cleanup();
  unknown.cleanup();
  otherHost.cleanup();
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

function settingsFor(server: { port: number }, overrides: Partial<SmtpSettings> = {}) {
  const settings: SmtpSettings = {
    host: 'localhost',
    port: server.port,
    implicitTls: false,
    ca: trusted.cert,
    connectTimeoutMs: 2000,
    attemptTimeoutMs: 4000,
    credentials: { user: USER, pass: PASSWORD },
    ...overrides,
  };
  return settings;
}

function deliver(
  server: { port: number },
  overrides: Partial<SmtpSettings> = {},
  message: OutgoingEmail = MESSAGE,
  signal: AbortSignal = AbortSignal.timeout(10_000)
): Promise<DeliveryAttempt> {
  return createSmtpTransport(settingsFor(server, overrides)).deliver(message, signal);
}

/** Commands of every session, flattened; `QUIT` is left out because its arrival races the close. */
function commands(server: MockSmtpServer): string[] {
  return server.sessions.flatMap((session) => session.commands).filter((verb) => verb !== 'QUIT');
}

async function closed(server: MockSmtpServer): Promise<void> {
  await vi.waitFor(() => expect(server.openConnections).toBe(0), { timeout: 2000 });
}

function failure(result: DeliveryAttempt): Extract<DeliveryAttempt, { accepted: false }> {
  if (result.accepted) throw new Error('expected the delivery to fail, but it was accepted');
  return result;
}

describe('delivery', () => {
  it('delivers over STARTTLS and authenticates only once TLS is up', async () => {
    const server = await startServer();

    expect(await deliver(server)).toEqual({ accepted: true });

    expect(commands(server)).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA']);
    // The server offered AUTH in plaintext too; the client must not have taken it.
    expect(server.sessions[0].auth).toEqual({ username: USER, password: PASSWORD, secure: true });
    expect(server.messages.length).toBe(1);
    expect(server.messages[0]).toMatchObject({
      secure: true,
      authenticated: true,
      from: 'no-reply@example.test',
      to: [RECIPIENT],
    });
    await closed(server);
  });

  it('delivers over implicit TLS', async () => {
    const server = await startServer({ implicitTls: true });

    expect(await deliver(server, { implicitTls: true })).toEqual({ accepted: true });

    expect(commands(server)).toEqual(['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA']);
    expect(server.sessions[0].auth?.secure).toBe(true);
    expect(server.messages[0]).toMatchObject({ secure: true, authenticated: true });
    await closed(server);
  });

  it('delivers through a relay that needs no credentials, without sending any', async () => {
    const server = await startServer();

    expect(await deliver(server, { credentials: undefined })).toEqual({ accepted: true });

    expect(commands(server)).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'MAIL', 'RCPT', 'DATA']);
    expect(server.sessions[0].auth).toBeUndefined();
    expect(server.messages[0].secure).toBe(true);
  });

  it('opens one connection per message and leaves none open', async () => {
    const server = await startServer();
    const transport = createSmtpTransport(settingsFor(server));

    await transport.deliver(MESSAGE, AbortSignal.timeout(10_000));
    await transport.deliver(MESSAGE, AbortSignal.timeout(10_000));

    expect(server.connections).toBe(2);
    expect(server.messages.length).toBe(2);
    await closed(server);
  });
});

describe('the message on the wire', () => {
  it('has the expected headers and exactly one recipient', async () => {
    const server = await startServer();
    await deliver(server);

    const { headers } = parseMessage(server.messages[0].raw);
    expect(headers.from).toBe('Acme Portal <no-reply@example.test>');
    expect(headers.to).toBe(RECIPIENT);
    expect(headers['reply-to']).toBe('support@example.test');
    expect(headers.subject).toBe(MESSAGE.subject);
    expect(headers['message-id']).toBe(MESSAGE.messageId);
    expect(headers['auto-submitted']).toBe('auto-generated');
    expect(headers['mime-version']).toBe('1.0');
    expect(headers.date).toBeTruthy();
    expect(headers.cc).toBeUndefined();
    expect(headers.bcc).toBeUndefined();
    // Nothing identifies the software or the host that sent it.
    expect(headers['x-mailer']).toBeUndefined();
    expect(headers['user-agent']).toBeUndefined();
  });

  it('carries a plain-text and an HTML alternative, in that order, intact', async () => {
    const server = await startServer();
    await deliver(server);

    const parsed = parseMessage(server.messages[0].raw);
    expect(parsed.headers['content-type']).toMatch(/^multipart\/alternative;/);
    expect(parsed.partTypes).toEqual(['text/plain', 'text/html']);
    expect(parsed.text.replace(/\r\n/g, '\n').trimEnd()).toBe(MESSAGE.text.trimEnd());
    expect(parsed.html.replace(/\r\n/g, '\n').trimEnd()).toBe(MESSAGE.html);
    expect(parsed.text).toContain(LINK);
    expect(parsed.html).toContain(`href="${LINK}"`);
  });

  it('encodes non-ASCII text instead of sending raw 8-bit headers', async () => {
    const server = await startServer();
    const subject = 'Invitation to the Müller & Søn client portal';
    await deliver(server, {}, { ...MESSAGE, subject, text: 'Grüße ✓\n' });

    const { raw } = server.messages[0];
    const parsed = parseMessage(raw);
    expect(parsed.headers.subject).toMatch(/^=\?UTF-8\?[QB]\?/);
    expect(raw.split('\r\n\r\n')[0]).toMatch(/^[\x20-\x7e\r\n\t]*$/);
    expect(parsed.text).toContain('Grüße ✓');
  });

  it('cannot be ended early from inside the body (SMTP smuggling)', async () => {
    const server = await startServer();
    const text = [
      'before',
      '.',
      `MAIL FROM:<${ATTACKER}>`,
      `RCPT TO:<${ATTACKER}>`,
      'DATA',
      'Subject: smuggled',
      '',
      'second message',
      '.',
      '.. leading dots stay',
      'after',
      '',
    ].join('\n');

    expect(await deliver(server, {}, { ...MESSAGE, text })).toEqual({ accepted: true });

    // One message, one envelope, and no command after DATA.
    expect(commands(server)).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA']);
    expect(server.messages.length).toBe(1);
    expect(server.messages[0].to).toEqual([RECIPIENT]);
    expect(parseMessage(server.messages[0].raw).text.replace(/\r\n/g, '\n')).toBe(text);
  });
});

describe('TLS is mandatory and verified', () => {
  /** Nothing reached the server over a channel it could have been read from. */
  function expectNothingSent(server: MockSmtpServer) {
    expect(server.sessions.every((session) => session.auth === undefined)).toBe(true);
    expect(commands(server)).not.toContain('AUTH');
    expect(commands(server)).not.toContain('MAIL');
    expect(server.messages.length).toBe(0);
  }

  it('refuses a server without STARTTLS instead of falling back to plaintext', async () => {
    const server = await startServer({ advertiseStartTls: false });

    const result = failure(await deliver(server));

    expect(result.reason).toBe('tls');
    expect(result.retryable).toBe(false);
    expect(commands(server)).toEqual(['EHLO', 'STARTTLS']);
    expectNothingSent(server);
    await closed(server);
  });

  it('refuses when the server declines the STARTTLS command', async () => {
    const server = await startServer({
      script: (step) => (step === 'starttls' ? '454 4.7.0 TLS not available' : undefined),
    });

    const result = failure(await deliver(server));

    expect(result.reason).toBe('tls');
    expectNothingSent(server);
  });

  it('refuses a certificate that does not chain to the configured trust anchor', async () => {
    const server = await startServer({ cert: unknown.cert, key: unknown.key });

    const result = failure(await deliver(server));

    expect(result).toMatchObject({ reason: 'tls', retryable: false });
    expect(result.diagnostics.cause).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
    expectNothingSent(server);
    await closed(server);
  });

  it('refuses a self-signed certificate when no trust anchor is configured', async () => {
    const server = await startServer();

    const result = failure(await deliver(server, { ca: undefined }));

    expect(result).toMatchObject({ reason: 'tls', retryable: false });
    expectNothingSent(server);
  });

  it('refuses a trusted certificate that was issued for a different host', async () => {
    const server = await startServer({ cert: otherHost.cert, key: otherHost.key });

    const result = failure(await deliver(server, { ca: otherHost.cert }));

    expect(result).toMatchObject({ reason: 'tls', retryable: false });
    expect(result.diagnostics.cause).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expectNothingSent(server);
  });

  it('refuses an untrusted certificate on an implicit-TLS port as well', async () => {
    const server = await startServer({ implicitTls: true, cert: unknown.cert, key: unknown.key });

    const result = failure(await deliver(server, { implicitTls: true }));

    expect(result).toMatchObject({ reason: 'tls', retryable: false });
    expectNothingSent(server);
  });

  it('keeps verifying when NODE_TLS_REJECT_UNAUTHORIZED=0 is set for the process', async () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    const server = await startServer({ cert: unknown.cert, key: unknown.key });

    const result = failure(await deliver(server));

    expect(result).toMatchObject({ reason: 'tls', retryable: false });
    expectNothingSent(server);
  });

  it('does not speak plaintext to a port that expects implicit TLS, or the reverse', async () => {
    // STARTTLS client against an implicit-TLS port: the greeting never arrives in clear.
    const tlsOnly = await startServer({ implicitTls: true });
    const first = failure(
      await deliver(tlsOnly, { implicitTls: false, connectTimeoutMs: 400, attemptTimeoutMs: 800 })
    );
    expect(first.reason).not.toBe('rejected');
    expectNothingSent(tlsOnly);

    // Implicit-TLS client against a plaintext port: the handshake fails.
    const plain = await startServer();
    const second = failure(
      await deliver(plain, { implicitTls: true, connectTimeoutMs: 400, attemptTimeoutMs: 800 })
    );
    expect(second.reason).not.toBe('rejected');
    expectNothingSent(plain);
  });
});

describe('authentication', () => {
  it('reports refused credentials, sends nothing and does not ask to be retried', async () => {
    const server = await startServer({
      script: (step) =>
        step === 'auth' ? '535 5.7.8 Authentication credentials invalid' : undefined,
    });

    const result = failure(await deliver(server));

    expect(result).toEqual({
      accepted: false,
      reason: 'authentication',
      retryable: false,
      diagnostics: { code: 'EAUTH', smtpStatus: 535, command: 'AUTH PLAIN' },
    });
    expect(commands(server)).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH']);
    expect(server.messages.length).toBe(0);
    expect(server.connections).toBe(1);
    await closed(server);
  });

  it('never retries an authentication failure, even a temporary one', async () => {
    // Repeating a refused login cannot help and can lock the account.
    const server = await startServer({
      script: (step) =>
        step === 'auth' ? '454 4.7.0 Temporary authentication failure' : undefined,
    });

    expect(failure(await deliver(server))).toMatchObject({
      reason: 'authentication',
      retryable: false,
    });
  });

  it('fails when credentials are configured but the server offers no authentication', async () => {
    // Carrying on unauthenticated would be a silent downgrade.
    const server = await startServer({ advertiseAuth: false });

    const result = failure(await deliver(server));

    expect(result).toMatchObject({ reason: 'authentication', retryable: false });
    expect(commands(server)).not.toContain('MAIL');
    expect(server.messages.length).toBe(0);
    // The attempt itself still happened inside TLS.
    expect(server.sessions[0].auth?.secure).toBe(true);
  });
});

describe('rejections', () => {
  it.each([
    ['the sender, permanently', 'mail', '550 5.7.1 Sender not allowed', false, 'MAIL FROM'],
    ['the sender, temporarily', 'mail', '451 4.3.0 Try again later', true, 'MAIL FROM'],
    ['the recipient, permanently', 'rcpt', '550 5.1.1 Mailbox unavailable', false, 'RCPT TO'],
    ['the recipient, temporarily', 'rcpt', '450 4.2.1 Mailbox busy', true, 'RCPT TO'],
    ['the DATA command, temporarily', 'data', '451 4.3.0 Try again later', true, 'DATA'],
    ['the message, permanently', 'message', '554 5.7.1 Rejected by policy', false, 'DATA'],
    ['the message, temporarily', 'message', '451 4.3.0 Try again later', true, 'DATA'],
  ] as const)('when the server refuses %s', async (_label, step, reply, retryable, command) => {
    const server = await startServer({ script: (at) => (at === step ? reply : undefined) });

    const result = failure(await deliver(server));

    expect(result.reason).toBe('rejected');
    // A 4xx reply means "not accepted, try later"; a 5xx reply is final.
    expect(result.retryable).toBe(retryable);
    expect(result.diagnostics.smtpStatus).toBe(Number(reply.slice(0, 3)));
    expect(result.diagnostics.command).toBe(command);
    await closed(server);
  });
});

describe('connection problems', () => {
  it('reports a refused connection as retryable: no session ever started', async () => {
    const server = await startServer();
    const port = server.port;
    await server.close();
    servers.length = 0;

    const result = failure(await deliver({ port }));

    expect(result).toEqual({
      accepted: false,
      reason: 'connection',
      retryable: true,
      diagnostics: { code: 'ESOCKET', cause: 'ECONNREFUSED', command: 'CONN' },
    });
  });

  it('gives up on a server that never greets, within the connect timeout', async () => {
    const server = await startServer({
      script: (step) => (step === 'greeting' ? HANG : undefined),
    });
    const startedAt = Date.now();

    const result = failure(
      await deliver(server, { connectTimeoutMs: 300, attemptTimeoutMs: 3000 })
    );

    expect(result).toMatchObject({ reason: 'timeout', retryable: true });
    expect(result.diagnostics.cause).toBe('GREETING_TIMEOUT');
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(commands(server)).toEqual([]);
    await closed(server);
  });

  it('treats a temporary refusal in the greeting as retryable', async () => {
    const server = await startServer({
      script: (step) => (step === 'greeting' ? '421 4.3.2 Service not available' : undefined),
    });

    expect(failure(await deliver(server))).toMatchObject({
      reason: 'connection',
      retryable: true,
      diagnostics: { smtpStatus: 421 },
    });
  });

  it('treats a permanent refusal in the greeting as final', async () => {
    const server = await startServer({
      script: (step) => (step === 'greeting' ? '554 5.3.2 No SMTP service here' : undefined),
    });

    expect(failure(await deliver(server))).toMatchObject({
      reason: 'connection',
      retryable: false,
    });
  });

  it('does not ask for a retry when the server goes silent after the message was sent', async () => {
    // The server may already hold the message; a retry could deliver it twice.
    const server = await startServer({ script: (step) => (step === 'message' ? HANG : undefined) });
    const startedAt = Date.now();

    const result = failure(await deliver(server, { attemptTimeoutMs: 400 }));

    expect(result).toMatchObject({ reason: 'timeout', retryable: false });
    expect(result.diagnostics.cause).toBe('SOCKET_TIMEOUT');
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(server.messages.length).toBe(1);
    await closed(server);
  });

  it('does not ask for a retry when the connection drops after the message was sent', async () => {
    const server = await startServer({ script: (step) => (step === 'message' ? DROP : undefined) });

    const result = failure(await deliver(server));

    expect(result).toMatchObject({ reason: 'connection', retryable: false });
    expect(server.messages.length).toBe(1);
  });

  it.each(['ehlo', 'auth', 'mail', 'rcpt', 'data'] as const)(
    'reports a connection that drops at %s without claiming a delivery',
    async (step) => {
      const server = await startServer({ script: (at) => (at === step ? DROP : undefined) });

      const result = failure(await deliver(server));

      expect(result.reason).toBe('connection');
      expect(result.retryable).toBe(false);
      expect(server.messages.length).toBe(0);
    }
  );

  it('stops when the caller aborts, and closes the connection', async () => {
    const controller = new AbortController();
    const server = await startServer({
      script: (step) => {
        if (step !== 'message') return undefined;
        setTimeout(() => controller.abort(), 20);
        return HANG;
      },
    });

    const result = failure(await deliver(server, {}, MESSAGE, controller.signal));

    expect(result).toMatchObject({ reason: 'timeout', retryable: false });
    await closed(server);
  });

  it('sends nothing when the caller has already aborted', async () => {
    const server = await startServer();

    const result = failure(await deliver(server, {}, MESSAGE, AbortSignal.abort()));

    expect(result).toMatchObject({ reason: 'timeout', retryable: false });
    expect(server.messages.length).toBe(0);
    await closed(server);
  });
});

describe('only one bare recipient ever reaches the library', () => {
  // Without the guard the library turns each of these into a delivery to
  // attacker@evil.example - in addition to, or instead of, the real recipient.
  it.each([
    ['a comma-separated list', `${RECIPIENT},${ATTACKER}`],
    ['a line break followed by a header', `${RECIPIENT}\r\nBcc: ${ATTACKER}`],
    ['an angle bracket followed by a command', `${RECIPIENT}> RCPT TO:<${ATTACKER}`],
    ['a display name', `Client <${ATTACKER}>`],
    ['a semicolon-separated list', `${RECIPIENT};${ATTACKER}`],
    ['an address with a trailing line feed', `${RECIPIENT}\n`],
  ])('refuses %s as the recipient without connecting', async (_label, to) => {
    const server = await startServer();

    const result = failure(await deliver(server, {}, { ...MESSAGE, to }));

    expect(result).toEqual({
      accepted: false,
      reason: 'invalid_message',
      retryable: false,
      diagnostics: {},
    });
    expect(server.connections).toBe(0);
    expect(server.messages.length).toBe(0);
  });

  it.each([
    [
      'the sender address',
      { from: { name: 'Acme', address: `no-reply@example.test,${ATTACKER}` } },
    ],
    [
      'the sender name',
      { from: { name: `Acme\r\nBcc: ${ATTACKER}`, address: 'no-reply@example.test' } },
    ],
    ['the reply-to address', { replyTo: `support@example.test\r\nBcc: ${ATTACKER}` }],
    ['the subject', { subject: `Hello\r\nBcc: ${ATTACKER}\r\n\r\nInjected body` }],
    ['the message id', { messageId: `<a@example.test>\r\nBcc: ${ATTACKER}` }],
  ] as Array<[string, Partial<OutgoingEmail>]>)(
    'refuses a line break or a list in %s without connecting',
    async (_label, override) => {
      const server = await startServer();

      const result = failure(await deliver(server, {}, { ...MESSAGE, ...override }));

      expect(result.reason).toBe('invalid_message');
      expect(server.connections).toBe(0);
    }
  );

  it('accepts an address whose domain the library rewrites to lower case', async () => {
    // The acceptance check counts recipients; comparing strings would report
    // this delivered message as a failure.
    const server = await startServer();

    expect(await deliver(server, {}, { ...MESSAGE, to: 'Client@Example.TEST' })).toEqual({
      accepted: true,
    });
    expect(server.messages[0].to).toEqual(['Client@example.test']);
  });
});

describe('nothing sensitive leaves the transport', () => {
  const SERVER_TEXT = 'SERVER-INTERNAL-DETAIL queue-id=AB12CD';

  it('returns codes only, never text from the server or the recipient', async () => {
    for (const step of ['auth', 'mail', 'rcpt', 'data', 'message'] as const) {
      const server = await startServer({
        script: (at) =>
          at === step ? `550 5.1.1 <${RECIPIENT}> ${SERVER_TEXT} user=${USER}` : undefined,
      });

      const serialized = JSON.stringify(failure(await deliver(server)));

      expect(serialized, step).not.toContain(SERVER_TEXT);
      expect(serialized, step).not.toContain(RECIPIENT);
      expect(serialized, step).not.toContain(USER);
      expect(serialized, step).not.toContain(PASSWORD);
      expect(serialized, step).not.toContain('example.test');
    }
  });

  it('writes nothing to the console, on success or on failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );

    await deliver(await startServer());
    await deliver(
      await startServer({ script: (step) => (step === 'auth' ? '535 5.7.8 Nope' : undefined) })
    );
    await deliver(await startServer({ cert: unknown.cert, key: unknown.key }));

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('classifySmtpError', () => {
  it.each([
    [{ code: 'EDNS', originalCode: 'ENOTFOUND' }, 'connection', true],
    [{ code: 'EDNS', originalCode: 'EAI_AGAIN' }, 'connection', true],
    [{ code: 'ESOCKET', originalCode: 'ECONNREFUSED' }, 'connection', true],
    [{ code: 'ESOCKET', originalCode: 'EHOSTUNREACH' }, 'connection', true],
    [{ code: 'ESOCKET', originalCode: 'ECONNRESET' }, 'connection', false],
    [{ code: 'ESOCKET', originalCode: 'EPIPE' }, 'connection', false],
    [{ code: 'ECONNECTION' }, 'connection', false],
    [{ code: 'EPROTOCOL', responseCode: 421 }, 'connection', true],
    [{ code: 'EPROTOCOL', responseCode: 554 }, 'connection', false],
    [{ code: 'EPROTOCOL', responseCode: 250 }, 'connection', false],
    [{ code: 'ETIMEDOUT', timeoutType: 'CONNECT_TIMEOUT' }, 'timeout', true],
    [{ code: 'ETIMEDOUT', timeoutType: 'GREETING_TIMEOUT' }, 'timeout', true],
    [{ code: 'ETIMEDOUT', timeoutType: 'UPGRADE_TIMEOUT' }, 'timeout', true],
    [{ code: 'ETIMEDOUT', timeoutType: 'SOCKET_TIMEOUT' }, 'timeout', false],
    [{ code: 'ETIMEDOUT' }, 'timeout', false],
    [{ code: 'EABORT' }, 'timeout', false],
    [{ code: 'ESOCKET', originalCode: 'DEPTH_ZERO_SELF_SIGNED_CERT' }, 'tls', false],
    [{ code: 'ESOCKET', originalCode: 'SELF_SIGNED_CERT_IN_CHAIN' }, 'tls', false],
    [{ code: 'ESOCKET', originalCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, 'tls', false],
    [{ code: 'ESOCKET', originalCode: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }, 'tls', false],
    [{ code: 'ESOCKET', originalCode: 'CERT_HAS_EXPIRED' }, 'tls', false],
    [{ code: 'ESOCKET', originalCode: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 'tls', false],
    [{ code: 'ESOCKET', originalCode: 'ERR_SSL_WRONG_VERSION_NUMBER' }, 'tls', false],
    [{ code: 'ESOCKET', originalCode: 'EPROTO' }, 'tls', false],
    [{ code: 'ETLS' }, 'tls', false],
    [{ code: 'ETLS', responseCode: 454 }, 'tls', true],
    [{ code: 'EREQUIRETLS' }, 'tls', false],
    [{ code: 'EAUTH', responseCode: 535 }, 'authentication', false],
    [{ code: 'EAUTH', responseCode: 454 }, 'authentication', false],
    [{ code: 'ENOAUTH' }, 'authentication', false],
    [{ code: 'EOAUTH2' }, 'authentication', false],
    [{ code: 'EENVELOPE', responseCode: 550 }, 'rejected', false],
    [{ code: 'EENVELOPE', responseCode: 450 }, 'rejected', true],
    [{ code: 'EENVELOPE', responseCode: 503 }, 'rejected', false],
    [{ code: 'EENVELOPE' }, 'invalid_message', false],
    [{ code: 'EMESSAGE', responseCode: 554 }, 'rejected', false],
    [{ code: 'EMESSAGE', responseCode: 452 }, 'rejected', true],
    [{ code: 'EFILEACCESS' }, 'invalid_message', false],
    [{ code: 'EURLACCESS' }, 'invalid_message', false],
    [{ code: 'ECONFIG' }, 'configuration', false],
    [{ code: 'ESTREAM' }, 'unknown', false],
    [{ code: 'SOMETHING_NEW' }, 'unknown', false],
    [{}, 'unknown', false],
  ])('%j -> %s (retryable: %s)', (error, reason, retryable) => {
    expect(classifySmtpError(error)).toMatchObject({ accepted: false, reason, retryable });
  });

  it('never marks an outcome retryable unless the message was certainly not accepted', () => {
    // No reply code and no proof that the session never started: unknown outcome.
    for (const code of ['ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EABORT', 'ESTREAM', undefined]) {
      expect(classifySmtpError({ code }).retryable, String(code)).toBe(false);
    }
  });

  it.each([null, undefined, 'a string', 42, new Error('boom'), []])(
    'handles the non-error value %j',
    (value) => {
      expect(classifySmtpError(value)).toEqual({
        accepted: false,
        reason: 'unknown',
        retryable: false,
        diagnostics: {},
      });
    }
  );

  it('copies codes only: free text in any field is dropped', () => {
    const error = Object.assign(new Error(`535 Authentication failed for ${USER} / ${PASSWORD}`), {
      code: 'EAUTH',
      responseCode: 535,
      command: 'AUTH PLAIN',
      response: `535 5.7.8 Authentication failed for ${USER}`,
      recipient: RECIPIENT,
      rejected: [RECIPIENT],
      originalCode: `not a code: ${PASSWORD}`,
      timeoutType: `text with <${RECIPIENT}>`,
    });

    const result = classifySmtpError(error);

    expect(result.diagnostics).toEqual({ code: 'EAUTH', smtpStatus: 535, command: 'AUTH PLAIN' });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain(RECIPIENT);
  });

  it('drops a code that is not shaped like one', () => {
    const result = classifySmtpError({
      code: `EAUTH\r\ninjected log line ${PASSWORD}`,
      command: `AUTH PLAIN ${Buffer.from(`\0${USER}\0${PASSWORD}`).toString('base64')}==`,
      responseCode: '535 not a number',
    });

    expect(result).toEqual({
      accepted: false,
      reason: 'unknown',
      retryable: false,
      diagnostics: {},
    });
  });
});
