/**
 * Transactional e-mail: shared types (pure module, no I/O).
 *
 * The delivery interface is deliberately small. A caller hands over one message
 * for one recipient and gets back one of three outcomes; nothing is thrown, and
 * no outcome carries a credential, a server response or the message itself.
 */

/** What a template renders. Both alternatives are always present. */
export interface EmailContent {
  subject: string;
  /** Plain-text alternative. */
  text: string;
  /** HTML alternative. Untrusted values are escaped by the template. */
  html: string;
}

/** One transactional message for exactly one recipient. */
export interface EmailMessage extends EmailContent {
  /** A single bare address (`name@example.com`); never a list or a display name. */
  to: string;
}

/**
 * Why a delivery failed. Coarse on purpose: specific enough for an
 * administrator to act on, never specific enough to leak configuration.
 */
export type EmailFailureReason =
  /** Delivery is enabled but its configuration is missing or invalid. Nothing was attempted. */
  | 'configuration'
  /** The recipient, subject or body failed local validation. Nothing was attempted. */
  | 'invalid_message'
  /** An outbound-mail limit has been reached. Nothing was attempted. */
  | 'rate_limited'
  /** The mail server could not be reached, or the connection broke. */
  | 'connection'
  /** The mail server did not answer in time. */
  | 'timeout'
  /** TLS could not be established, or the server certificate was not trusted. */
  | 'tls'
  /** The mail server refused the credentials. */
  | 'authentication'
  /** The mail server refused the sender, the recipient or the message. */
  | 'rejected'
  | 'unknown';

export type EmailDeliveryResult =
  /** The mail server accepted the message for delivery (it may still bounce later). */
  | { status: 'sent'; messageId: string; attempts: number }
  /** Nothing was sent, and the message must not be treated as delivered. */
  | { status: 'failed'; reason: EmailFailureReason; attempts: number }
  /** E-mail delivery is switched off in this environment. Nothing was sent. */
  | { status: 'disabled' };

/** The part of a delivery result that is safe to return from an API. */
export type EmailDeliverySummary =
  { status: 'sent' } | { status: 'disabled' } | { status: 'failed'; reason: EmailFailureReason };

export function summarizeDelivery(result: EmailDeliveryResult): EmailDeliverySummary {
  if (result.status === 'failed') return { status: 'failed', reason: result.reason };
  return { status: result.status };
}

/**
 * What the audit trail should record about a delivery, or `null` when nothing
 * was attempted (delivery disabled).
 *
 * `email_sent` exists only for a message the mail server accepted, so the trail
 * can never show a delivery that did not happen. The details hold a message id
 * for correlating with mail-server logs, or the failure reason - never the
 * recipient, the link or anything from the message.
 */
export function deliveryAuditRecord(
  result: EmailDeliveryResult
): { event: 'email_sent' | 'email_failed'; details: Record<string, unknown> } | null {
  if (result.status === 'sent') {
    return {
      event: 'email_sent',
      details: { messageId: result.messageId, attempts: result.attempts },
    };
  }
  if (result.status === 'failed') {
    return { event: 'email_failed', details: { reason: result.reason, attempts: result.attempts } };
  }
  return null;
}

/** A message as a transport receives it: validated, with the sender identity applied. */
export interface OutgoingEmail extends EmailMessage {
  from: { name: string; address: string };
  replyTo?: string;
  /**
   * Stable across retry attempts, so a relay that did receive an earlier attempt
   * can recognise the duplicate.
   */
  messageId: string;
}

/** Diagnostics that are safe to log: codes only, never text from the server. */
export interface DeliveryDiagnostics {
  /** Error class reported by the SMTP client, e.g. `EAUTH`. */
  code?: string;
  /** Underlying system or TLS error code, e.g. `ECONNREFUSED`. */
  cause?: string;
  /** Numeric SMTP reply code. */
  smtpStatus?: number;
  /** SMTP command the server was answering, e.g. `RCPT TO`. */
  command?: string;
}

export type DeliveryAttempt =
  | { accepted: true }
  | {
      accepted: false;
      reason: EmailFailureReason;
      /**
       * True only when the message was certainly not accepted and a later attempt
       * may succeed. An outcome that is merely unknown is never retryable: a
       * second attempt could deliver a duplicate.
       */
      retryable: boolean;
      diagnostics: DeliveryDiagnostics;
    };

/** A delivery provider. `deliver` makes exactly one attempt and never rejects. */
export interface EmailTransport {
  deliver(message: OutgoingEmail, signal: AbortSignal): Promise<DeliveryAttempt>;
}
