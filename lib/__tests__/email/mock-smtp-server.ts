/**
 * Test support for the e-mail delivery suite: a scriptable, in-process SMTP
 * server on a loopback socket and a throwaway TLS certificate.
 *
 * The server implements only what the SMTP transport relies on (greeting, EHLO,
 * STARTTLS or implicit TLS, AUTH PLAIN, MAIL / RCPT / DATA). It records what the
 * client sent - including whether the credentials arrived over TLS - and lets a
 * test inject a failure at any step. Nothing ever leaves the process, so no real
 * e-mail can be sent from a test run.
 *
 * Not a test file itself: Vitest only collects `*.test.ts`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net, { type AddressInfo, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

export interface TestCertificate {
  /** PEM certificate. Self-signed, so it is also its own trust anchor. */
  cert: string;
  /** PEM private key. Generated per run and never written to the repository. */
  key: string;
  /** Absolute path of the certificate, for `SMTP_TLS_CA_FILE`. */
  certFile: string;
  /** Remove the temporary directory. */
  cleanup(): void;
}

/**
 * Generate a throwaway self-signed certificate with the `openssl` CLI, the same
 * way `backup/backup-shipping.test.ts` does. Valid for one day.
 */
export function createTestCertificate(
  options: { commonName?: string; subjectAltName?: string } = {}
): TestCertificate {
  const commonName = options.commonName ?? 'localhost';
  const subjectAltName = options.subjectAltName ?? 'DNS:localhost,IP:127.0.0.1';
  const dir = mkdtempSync(path.join(os.tmpdir(), 'email-cert-'));
  const certFile = path.join(dir, 'cert.pem');
  const keyFile = path.join(dir, 'key.pem');

  execFileSync(
    'openssl',
    [
      ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1'],
      ...['-subj', `/CN=${commonName}`, '-addext', `subjectAltName=${subjectAltName}`],
      ...['-keyout', keyFile, '-out', certFile],
    ],
    { stdio: 'ignore' }
  );

  return {
    cert: readFileSync(certFile, 'utf8'),
    key: readFileSync(keyFile, 'utf8'),
    certFile,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export type SmtpStep =
  'greeting' | 'ehlo' | 'starttls' | 'auth' | 'mail' | 'rcpt' | 'data' | 'message';

/** Keep the connection open and never answer. */
export const HANG = Symbol('hang');
/** Close the connection without answering. */
export const DROP = Symbol('drop');

export type ScriptedReply = string | typeof HANG | typeof DROP | undefined;

export interface MockSmtpSession {
  /** 1-based number of this TCP connection. */
  connection: number;
  /** Whether the connection is TLS-protected right now. */
  secure: boolean;
  /** Command verbs in the order they arrived (never the AUTH payload). */
  commands: string[];
  /** Credentials the client presented, and whether TLS protected them. */
  auth?: { username: string; password: string; secure: boolean };
  authenticated: boolean;
}

export interface ReceivedMessage {
  connection: number;
  secure: boolean;
  authenticated: boolean;
  from: string;
  to: string[];
  /** The message exactly as transmitted (headers and encoded body). */
  raw: string;
}

export interface MockSmtpServer {
  port: number;
  /** TCP connections accepted so far, including ones that never completed TLS. */
  readonly connections: number;
  /** TCP connections that are still open right now. */
  readonly openConnections: number;
  sessions: MockSmtpSession[];
  /** Messages whose body was fully received, whatever the server answered. */
  messages: ReceivedMessage[];
  close(): Promise<void>;
}

export interface MockSmtpOptions {
  cert: string;
  key: string;
  /** Speak TLS from the first byte (port 465 style) instead of offering STARTTLS. */
  implicitTls?: boolean;
  /**
   * Offer STARTTLS on a plaintext connection. Default true. When false the
   * capability is not advertised and the command is refused, like a server that
   * has no TLS at all.
   */
  advertiseStartTls?: boolean;
  /** Advertise AUTH. Default true. When false the command is refused. */
  advertiseAuth?: boolean;
  /**
   * Override the reply for a step. Return `undefined` for the default reply,
   * `HANG` to stay silent or `DROP` to close the connection.
   */
  script?: (step: SmtpStep, session: MockSmtpSession) => ScriptedReply;
}

const DEFAULT_REPLIES: Record<Exclude<SmtpStep, 'ehlo'>, string> = {
  greeting: '220 mock.smtp.test ESMTP ready',
  starttls: '220 2.0.0 Ready to start TLS',
  auth: '235 2.7.0 Authentication successful',
  mail: '250 2.1.0 Sender OK',
  rcpt: '250 2.1.5 Recipient OK',
  data: '354 End data with <CR><LF>.<CR><LF>',
  message: '250 2.0.0 OK: queued',
};

export async function startMockSmtpServer(options: MockSmtpOptions): Promise<MockSmtpServer> {
  const sockets = new Set<Socket>();
  const sessions: MockSmtpSession[] = [];
  const messages: ReceivedMessage[] = [];
  let connections = 0;

  const secureContext = tls.createSecureContext({ cert: options.cert, key: options.key });

  function serve(initialSocket: Socket, session: MockSmtpSession) {
    let socket = initialSocket;
    let buffer = '';
    let readingMessage = false;
    let envelope: { from: string; to: string[] } = { from: '', to: [] };

    const send = (line: string) => {
      if (!socket.destroyed) socket.write(`${line}\r\n`);
    };

    /** Apply the script for `step`; returns the reply that was sent, if any. */
    const answer = (step: SmtpStep, fallback: string): string | null => {
      const scripted = options.script?.(step, session);
      if (scripted === HANG) return null;
      if (scripted === DROP) {
        socket.destroy();
        return null;
      }
      const reply = scripted ?? fallback;
      send(reply);
      return reply;
    };

    const ehloReply = () => {
      const lines = ['mock.smtp.test'];
      if (!session.secure && options.advertiseStartTls !== false) lines.push('STARTTLS');
      // Advertised even in plaintext on purpose: a client must not authenticate
      // before TLS just because a (hostile or misconfigured) server offers it.
      if (options.advertiseAuth !== false) lines.push('AUTH PLAIN');
      return lines
        .map((line, index) => `250${index === lines.length - 1 ? ' ' : '-'}${line}`)
        .join('\r\n');
    };

    const onCommand = (line: string) => {
      const verb = line.split(' ')[0].toUpperCase();
      const upper = line.toUpperCase();

      if (verb === 'AUTH') {
        session.commands.push('AUTH');
        const [, , encoded = ''] = line.split(' ');
        const [, username = '', password = ''] = Buffer.from(encoded, 'base64')
          .toString('utf8')
          .split('\0');
        session.auth = { username, password, secure: session.secure };
        const reply = answer(
          'auth',
          options.advertiseAuth === false
            ? '503 5.5.1 Authentication is not available'
            : DEFAULT_REPLIES.auth
        );
        session.authenticated = reply?.startsWith('235') ?? false;
        return;
      }

      session.commands.push(upper.startsWith('MAIL FROM') ? 'MAIL' : verb);

      if (verb === 'EHLO' || verb === 'HELO') {
        answer('ehlo', ehloReply());
      } else if (verb === 'STARTTLS') {
        const reply = answer(
          'starttls',
          options.advertiseStartTls === false
            ? '502 5.5.1 Command not implemented'
            : DEFAULT_REPLIES.starttls
        );
        if (!reply?.startsWith('220')) return;
        // Everything after this point is TLS: stop reading the plain socket.
        socket.removeListener('data', onData);
        buffer = '';
        const upgraded = new tls.TLSSocket(socket, { isServer: true, secureContext });
        upgraded.on('error', () => undefined);
        upgraded.on('secure', () => {
          session.secure = true;
        });
        upgraded.on('data', onData);
        socket = upgraded;
      } else if (upper.startsWith('MAIL FROM')) {
        envelope = { from: /<([^>]*)>/.exec(line)?.[1] ?? '', to: [] };
        answer('mail', DEFAULT_REPLIES.mail);
      } else if (upper.startsWith('RCPT TO')) {
        const reply = answer('rcpt', DEFAULT_REPLIES.rcpt);
        if (reply?.startsWith('250')) envelope.to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
      } else if (verb === 'DATA') {
        const reply = answer('data', DEFAULT_REPLIES.data);
        if (reply?.startsWith('354')) readingMessage = true;
      } else if (verb === 'QUIT') {
        send('221 2.0.0 Bye');
        socket.end();
      } else {
        send('250 2.0.0 OK');
      }
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      for (;;) {
        if (readingMessage) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          const raw = buffer.slice(0, end + 2).replace(/\r\n\.\./g, '\r\n.');
          buffer = buffer.slice(end + 5);
          readingMessage = false;
          messages.push({
            connection: session.connection,
            secure: session.secure,
            authenticated: session.authenticated,
            from: envelope.from,
            to: [...envelope.to],
            raw,
          });
          answer('message', DEFAULT_REPLIES.message);
        } else {
          const end = buffer.indexOf('\r\n');
          if (end === -1) return;
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          onCommand(line);
        }
      }
    };

    socket.on('data', onData);
    answer('greeting', DEFAULT_REPLIES.greeting);
  }

  const track = (socket: Socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    return connections;
  };

  const newSession = (connection: number, secure: boolean): MockSmtpSession => {
    const session = { connection, secure, commands: [], authenticated: false };
    sessions.push(session);
    return session;
  };

  let server: net.Server;
  if (options.implicitTls) {
    const numbers = new WeakMap<Socket, number>();
    const tlsServer = tls.createServer({ cert: options.cert, key: options.key }, (socket) => {
      socket.on('error', () => undefined);
      // `secureConnection` hands over the TLS socket; map it back to its TCP connection.
      const raw = (socket as unknown as { _parent?: Socket })._parent;
      serve(socket, newSession((raw && numbers.get(raw)) ?? connections, true));
    });
    tlsServer.on('connection', (socket: Socket) => numbers.set(socket, track(socket)));
    tlsServer.on('tlsClientError', () => undefined);
    server = tlsServer;
  } else {
    server = net.createServer((socket) => serve(socket, newSession(track(socket), false)));
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: (server.address() as AddressInfo).port,
    get connections() {
      return connections;
    },
    get openConnections() {
      return sockets.size;
    },
    sessions,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

export interface ParsedMessage {
  /** Header values keyed by lower-case name (unfolded, still RFC 2047 encoded). */
  headers: Record<string, string>;
  /** Decoded `text/plain` alternative. */
  text: string;
  /** Decoded `text/html` alternative. */
  html: string;
  /** Content types of the alternatives, in order. */
  partTypes: string[];
}

function splitHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0)
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

function decodeBody(body: string, encoding: string | undefined): string {
  const kind = (encoding ?? '7bit').toLowerCase();
  if (kind === 'base64') return Buffer.from(body, 'base64').toString('utf8');
  if (kind === 'quoted-printable') {
    const bytes = body
      .replace(/=\r\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return Buffer.from(body, 'latin1').toString('utf8');
}

/** Minimal parser for the `multipart/alternative` messages the mailer produces. */
export function parseMessage(raw: string): ParsedMessage {
  const separator = raw.indexOf('\r\n\r\n');
  const headers = splitHeaders(raw.slice(0, separator));
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headers['content-type'] ?? '')?.[1];
  const parsed: ParsedMessage = { headers, text: '', html: '', partTypes: [] };
  if (!boundary) return parsed;

  const sections = raw
    .slice(separator + 4)
    .split(`--${boundary}`)
    .slice(1, -1);

  for (const section of sections) {
    const part = section.replace(/^\r\n/, '');
    const split = part.indexOf('\r\n\r\n');
    const partHeaders = splitHeaders(part.slice(0, split));
    const type = (partHeaders['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const body = decodeBody(
      part.slice(split + 4).replace(/\r\n$/, ''),
      partHeaders['content-transfer-encoding']
    );
    parsed.partTypes.push(type);
    if (type === 'text/plain') parsed.text = body;
    if (type === 'text/html') parsed.html = body;
  }
  return parsed;
}
