import 'server-only';

import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { isDeliverableAddress, isSingleLine } from '@/lib/email/address';

/**
 * E-mail delivery configuration, read from the environment.
 *
 * Safe by default: unless `EMAIL_TRANSPORT=smtp` is set explicitly, delivery is
 * `disabled` and no code path can open a connection - which is what local
 * development, the test suites and CI run with.
 *
 * When SMTP is selected the configuration fails closed. Anything missing or
 * malformed yields `invalid` (and every send reports a `configuration` failure)
 * rather than a best-effort guess, and there is no setting that weakens TLS:
 *
 *  - the connection is either TLS from the first byte or must upgrade with
 *    STARTTLS before anything else is sent; there is no plaintext mode;
 *  - the server certificate is always verified. `SMTP_TLS_CA_FILE` can pin the
 *    trust anchors for a privately issued certificate, it cannot disable
 *    verification;
 *  - links in a message point at the configured application origin, which must
 *    be https (http is accepted for localhost only). The origin is never taken
 *    from a request header.
 *
 * `problems` name the variable at fault and never echo a value, so they can be
 * logged. Credentials are kept non-enumerable so the settings object can be
 * logged or serialized without exposing them.
 */

export interface SmtpCredentials {
  user: string;
  pass: string;
}

export interface SmtpSettings {
  host: string;
  port: number;
  /** `true`: TLS from the first byte (port 465). `false`: STARTTLS is mandatory. */
  implicitTls: boolean;
  /** PEM trust anchors used instead of the default CA store for this connection. */
  ca?: string;
  /** Limit for DNS, connect, greeting and the TLS upgrade. */
  connectTimeoutMs: number;
  /** Hard limit for one whole delivery attempt. */
  attemptTimeoutMs: number;
  /** Non-enumerable. Absent for a relay that authenticates by network address. */
  readonly credentials?: SmtpCredentials;
}

export interface EmailSettings {
  /** Origin every link in a message points at, e.g. `https://app.example.com`. */
  appUrl: string;
  from: { name: string; address: string };
  replyTo?: string;
  /** Delivery attempts per message, including the first. */
  maxAttempts: number;
  /** Delay before the first retry; doubles for each further one. */
  retryDelayMs: number;
  smtp: SmtpSettings;
}

export type EmailConfig =
  | { mode: 'disabled' }
  | { mode: 'invalid'; problems: string[] }
  | { mode: 'smtp'; settings: EmailSettings };

type Environment = Record<string, string | undefined>;

const DEFAULT_FROM_NAME = 'AgencyOS';
const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;
const MAX_CONNECT_TIMEOUT_MS = 5_000;

const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const value = (env: Environment, name: string) => (env[name] ?? '').trim();

/** Parse an optional whole number; `null` when present but out of range. */
function wholeNumber(raw: string, fallback: number, min: number, max: number): number | null {
  if (raw === '') return fallback;
  if (!/^\d{1,9}$/.test(raw)) return null;
  const parsed = Number(raw);
  return parsed >= min && parsed <= max ? parsed : null;
}

/**
 * The origin links are built on: the same precedence as Better Auth and the
 * origin check (`BETTER_AUTH_URL`, then `NEXT_PUBLIC_APP_URL`), but without the
 * localhost fallback - a message must never carry a link nobody configured.
 */
function resolveAppUrl(env: Environment): string | null {
  let url: URL;
  try {
    url = new URL(value(env, 'BETTER_AUTH_URL') || value(env, 'NEXT_PUBLIC_APP_URL'));
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

export function loadEmailConfig(env: Environment = process.env): EmailConfig {
  const transport = value(env, 'EMAIL_TRANSPORT').toLowerCase();
  if (transport === '' || transport === 'disabled') return { mode: 'disabled' };
  if (transport !== 'smtp') {
    return { mode: 'invalid', problems: ['EMAIL_TRANSPORT must be "smtp" or "disabled"'] };
  }

  const problems: string[] = [];

  const host = value(env, 'SMTP_HOST');
  if (!HOST_NAME.test(host) && net.isIP(host) === 0) {
    problems.push('SMTP_HOST is missing or is not a host name');
  }

  const secure = value(env, 'SMTP_SECURE').toLowerCase();
  if (!['', 'true', 'false'].includes(secure)) {
    problems.push('SMTP_SECURE must be "true" or "false"');
  }
  const port = wholeNumber(value(env, 'SMTP_PORT'), secure === 'true' ? 465 : 587, 1, 65_535);
  if (port === null) problems.push('SMTP_PORT must be a port number');
  // Port 465 is implicit TLS by convention; an explicit SMTP_SECURE always wins.
  const implicitTls = secure === '' ? port === 465 : secure === 'true';

  // Not trimmed: a password is taken exactly as configured.
  const user = env.SMTP_USER ?? '';
  const pass = env.SMTP_PASS ?? '';
  if ((user === '') !== (pass === '')) {
    problems.push('SMTP_USER and SMTP_PASS must be set together');
  } else if (!isSingleLine(user) || !isSingleLine(pass)) {
    // Usually a trailing newline from a secret file.
    problems.push('SMTP_USER and SMTP_PASS must not contain line breaks or control characters');
  }

  let ca: string | undefined;
  const caFile = value(env, 'SMTP_TLS_CA_FILE');
  if (caFile !== '') {
    if (!path.isAbsolute(caFile)) {
      problems.push('SMTP_TLS_CA_FILE must be an absolute path');
    } else {
      try {
        ca = readFileSync(caFile, 'utf8');
      } catch {
        problems.push('SMTP_TLS_CA_FILE could not be read');
      }
      if (ca !== undefined && !ca.includes('-----BEGIN CERTIFICATE-----')) {
        problems.push('SMTP_TLS_CA_FILE does not contain a PEM certificate');
      }
    }
  }

  const fromAddress = value(env, 'EMAIL_FROM_ADDRESS');
  if (!isDeliverableAddress(fromAddress)) {
    problems.push('EMAIL_FROM_ADDRESS is missing or is not a valid e-mail address');
  }
  const fromName = value(env, 'EMAIL_FROM_NAME') || DEFAULT_FROM_NAME;
  if (!isSingleLine(fromName) || fromName.length > 100) {
    problems.push('EMAIL_FROM_NAME must be a single line of at most 100 characters');
  }
  const replyTo = value(env, 'EMAIL_REPLY_TO');
  if (replyTo !== '' && !isDeliverableAddress(replyTo)) {
    problems.push('EMAIL_REPLY_TO is not a valid e-mail address');
  }

  const appUrl = resolveAppUrl(env);
  if (appUrl === null) {
    problems.push(
      'BETTER_AUTH_URL (or NEXT_PUBLIC_APP_URL) must be the https:// origin of the application; http:// is accepted for localhost only'
    );
  }

  // Both are capped low on purpose: a send happens inside the request that
  // triggered it, so attempts x timeout is how long that request can be held.
  const attemptTimeoutMs = wholeNumber(
    value(env, 'SMTP_TIMEOUT_MS'),
    DEFAULT_ATTEMPT_TIMEOUT_MS,
    1_000,
    30_000
  );
  if (attemptTimeoutMs === null) problems.push('SMTP_TIMEOUT_MS must be between 1000 and 30000');
  const maxAttempts = wholeNumber(value(env, 'SMTP_MAX_ATTEMPTS'), DEFAULT_MAX_ATTEMPTS, 1, 3);
  if (maxAttempts === null) problems.push('SMTP_MAX_ATTEMPTS must be between 1 and 3');

  if (
    problems.length > 0 ||
    port === null ||
    appUrl === null ||
    attemptTimeoutMs === null ||
    maxAttempts === null
  ) {
    return { mode: 'invalid', problems };
  }

  const smtp: SmtpSettings = {
    host,
    port,
    implicitTls,
    ...(ca ? { ca } : {}),
    // Setting the connection up may use at most half of the attempt, so a server
    // that never answers is told apart from one that stalls mid-message.
    connectTimeoutMs: Math.min(MAX_CONNECT_TIMEOUT_MS, Math.floor(attemptTimeoutMs / 2)),
    attemptTimeoutMs,
  };
  if (user !== '') {
    Object.defineProperty(smtp, 'credentials', {
      enumerable: false,
      value: Object.freeze({ user, pass }),
    });
  }

  return {
    mode: 'smtp',
    settings: {
      appUrl,
      from: { name: fromName, address: fromAddress },
      ...(replyTo ? { replyTo } : {}),
      maxAttempts,
      retryDelayMs: RETRY_DELAY_MS,
      smtp,
    },
  };
}
