import 'server-only';

import nodemailer from 'nodemailer';

import { isDeliverableAddress, isSingleLine } from '@/lib/email/address';
import type { SmtpSettings } from '@/lib/email/config';
import type {
  DeliveryAttempt,
  EmailFailureReason,
  EmailTransport,
  OutgoingEmail,
} from '@/lib/email/types';

/**
 * The SMTP transport: the one provider used in deployment.
 *
 * Built on Nodemailer (a single dependency with no dependencies of its own)
 * rather than a hand-written SMTP client, so header encoding, MIME structure and
 * the STARTTLS state machine are the library's, not ours.
 *
 * Every send opens one connection and closes it; there is no pool and no shared
 * state. One call to `deliver` is exactly one attempt - retrying is the
 * mailer's decision, made from the classification returned here.
 */
export function createSmtpTransport(smtp: SmtpSettings): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // TLS is not optional. Either the connection is encrypted from the first
    // byte, or STARTTLS must succeed before anything else is sent: `requireTLS`
    // turns a server that does not offer it into a failure, never into a
    // plaintext session, so credentials and message never travel unencrypted.
    secure: smtp.implicitTls,
    requireTLS: !smtp.implicitTls,
    tls: {
      // Stated explicitly so that NODE_TLS_REJECT_UNAUTHORIZED=0 in the process
      // environment cannot switch verification off for this connection.
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ...(smtp.ca ? { ca: smtp.ca } : {}),
    },
    // With credentials configured, a session that cannot authenticate is a
    // failure. Without `forceAuth` the library would quietly carry on
    // unauthenticated when the server does not advertise AUTH.
    ...(smtp.credentials
      ? {
          auth: { user: smtp.credentials.user, pass: smtp.credentials.pass },
          forceAuth: true,
        }
      : {}),
    connectionTimeout: smtp.connectTimeoutMs,
    greetingTimeout: smtp.connectTimeoutMs,
    dnsTimeout: smtp.connectTimeoutMs,
    socketTimeout: smtp.attemptTimeoutMs,
    // The library's logger can print SMTP traffic. It stays off.
    logger: false,
    debug: false,
    // Message content is always an in-memory string, never a path or a URL.
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    async deliver(message: OutgoingEmail, signal: AbortSignal): Promise<DeliveryAttempt> {
      // Checked here as well as by the mailer, because this is the last point
      // before the library and its address parser is lenient: handed
      // "a@x.test,b@y.test", or an address containing a line break or an angle
      // bracket, it delivers to a second - or to a different - recipient, even
      // when the envelope is given explicitly (pinned in smtp-transport.test.ts).
      // Nothing but single bare mailboxes and single-line header values gets past.
      if (!isSafeToHandOver(message)) {
        return { accepted: false, reason: 'invalid_message', retryable: false, diagnostics: {} };
      }

      try {
        const info = await transporter.sendMail({
          from: message.from,
          to: { name: '', address: message.to },
          ...(message.replyTo ? { replyTo: { name: '', address: message.replyTo } } : {}),
          envelope: { from: message.from.address, to: [message.to] },
          subject: message.subject,
          text: message.text,
          html: message.html,
          messageId: message.messageId,
          // RFC 3834: tells auto-responders not to answer an automated message.
          headers: { 'Auto-Submitted': 'auto-generated' },
          signal,
        });

        // One recipient was offered, so exactly one must have been accepted.
        // Counted rather than compared, because the library reports the address
        // in normalized form (it lower-cases the domain). Anything else cannot
        // be vouched for and is not reported as a delivery.
        if (info.accepted.length !== 1 || info.rejected.length !== 0) {
          return { accepted: false, reason: 'unknown', retryable: false, diagnostics: {} };
        }
        return { accepted: true };
      } catch (error) {
        return classifySmtpError(error);
      }
    },
  };
}

function isSafeToHandOver(message: OutgoingEmail): boolean {
  return (
    isDeliverableAddress(message.to) &&
    isDeliverableAddress(message.from?.address) &&
    (message.replyTo === undefined || isDeliverableAddress(message.replyTo)) &&
    [message.from.name, message.subject, message.messageId].every(
      (value) => typeof value === 'string' && isSingleLine(value)
    )
  );
}

/** Errors that prove no SMTP session ever started. */
const NEVER_CONNECTED = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** Timeouts that fire before the first SMTP command is sent. */
const SETUP_TIMEOUTS = new Set(['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT']);

/** Node.js / OpenSSL codes for a certificate that failed verification, or a broken handshake. */
const TLS_FAILURE =
  /CERT|ISSUER|SIGNATURE|INVALID_CA|PATH_LENGTH|INVALID_PURPOSE|HOSTNAME_MISMATCH|^ERR_TLS_|^ERR_SSL_|^EPROTO$/;

/** Keep a diagnostic code only if it looks like one; never free text from the server. */
function codeOf(input: unknown): string | undefined {
  return typeof input === 'string' && /^[A-Za-z0-9_ ]{1,48}$/.test(input) ? input : undefined;
}

/**
 * Turn an SMTP client error into a reason and a retry decision.
 *
 * Only codes are read from the error. Its message can quote the server's reply
 * (which may name the recipient), so it is neither returned nor logged.
 *
 * A failure is retryable only when the message was certainly not accepted:
 *  - the server answered with a transient status (4xx) - it said "not now"; or
 *  - the session never started (refused, unresolvable, no greeting in time).
 * A connection that breaks or stalls mid-session is NOT retried: the server may
 * already hold the message, and a second attempt could deliver it twice.
 * Authentication failures are never retried either - the credentials will not
 * change between attempts, and repeated failures can lock the account.
 */
export function classifySmtpError(error: unknown): Extract<DeliveryAttempt, { accepted: false }> {
  const details = (error ?? {}) as Record<string, unknown>;
  const code = codeOf(details.code);
  const cause = codeOf(details.originalCode) ?? codeOf(details.timeoutType);
  const smtpStatus =
    typeof details.responseCode === 'number' && Number.isInteger(details.responseCode)
      ? details.responseCode
      : undefined;

  let reason: EmailFailureReason;
  if (code === 'EAUTH' || code === 'ENOAUTH' || code === 'EOAUTH2') {
    reason = 'authentication';
  } else if (code === 'ETLS' || code === 'EREQUIRETLS' || TLS_FAILURE.test(cause ?? '')) {
    reason = 'tls';
  } else if (code === 'ETIMEDOUT' || code === 'EABORT') {
    reason = 'timeout';
  } else if (code === 'EENVELOPE' || code === 'EMESSAGE') {
    reason = smtpStatus === undefined ? 'invalid_message' : 'rejected';
  } else if (code === 'EFILEACCESS' || code === 'EURLACCESS') {
    reason = 'invalid_message';
  } else if (code === 'ECONFIG') {
    reason = 'configuration';
  } else if (
    code === 'ESOCKET' ||
    code === 'ECONNECTION' ||
    code === 'EDNS' ||
    code === 'EPROTOCOL'
  ) {
    reason = 'connection';
  } else {
    reason = 'unknown';
  }

  const transientReply = smtpStatus !== undefined && smtpStatus >= 400 && smtpStatus < 500;
  const neverConnected =
    code === 'EDNS' ||
    (code === 'ESOCKET' && NEVER_CONNECTED.has(cause ?? '')) ||
    (code === 'ETIMEDOUT' && SETUP_TIMEOUTS.has(cause ?? ''));

  return {
    accepted: false,
    reason,
    retryable: reason !== 'authentication' && (transientReply || neverConnected),
    diagnostics: {
      ...(code ? { code } : {}),
      ...(cause ? { cause } : {}),
      ...(smtpStatus !== undefined ? { smtpStatus } : {}),
      ...(codeOf(details.command) ? { command: codeOf(details.command) } : {}),
    },
  };
}
