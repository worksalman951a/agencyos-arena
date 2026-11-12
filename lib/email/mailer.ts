import 'server-only';

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { isDeliverableAddress, isSingleLine } from '@/lib/email/address';
import { loadEmailConfig } from '@/lib/email/config';
import { createSmtpTransport } from '@/lib/email/smtp-transport';
import type {
  DeliveryAttempt,
  DeliveryDiagnostics,
  EmailDeliveryResult,
  EmailFailureReason,
  EmailMessage,
  EmailTransport,
  OutgoingEmail,
} from '@/lib/email/types';

/**
 * Transactional e-mail delivery.
 *
 * `sendEmail` is the one entry point. It is synchronous with respect to the
 * caller: the returned promise settles when the mail server has accepted the
 * message or delivery has been given up, so a caller can say truthfully whether
 * the message went out. It never throws.
 *
 * There is deliberately no queue and no outbox here. An invitation link carries
 * a token whose plaintext exists only in memory (the database keeps its hash),
 * so parking a rendered message for a later retry would mean storing a usable
 * credential. Retries are therefore bounded, in-process and immediate; see
 * docs/phase-4d/email-delivery.md for what a durable retry would require.
 *
 * Nothing in this module logs a recipient, a subject, a body, a link or a
 * credential. Log lines carry reasons and status codes only.
 */

/**
 * Builds the message. It receives `link`, which turns an application path into
 * an absolute URL on the configured origin, and is only called when a message is
 * actually going to be sent - with delivery disabled no link is ever rendered.
 */
export type ComposeEmail = (link: (path: string) => string) => EmailMessage;

export interface SendEmailOptions {
  /**
   * Outbound-mail budget. Asked once, and only when a message is really about
   * to be sent: delivery is enabled, the configuration is valid and so is the
   * message. Resolving `false` means the message must not be sent (and the
   * budget is expected to have logged which limit was reached).
   */
  reserve?: () => Promise<boolean>;
  /** Where the configuration is read from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export interface RetryPolicy {
  /** Attempts per message, including the first. */
  maxAttempts: number;
  /** Delay before the first retry; doubles for each further one. */
  retryDelayMs: number;
  /** Hard limit for one attempt. */
  attemptTimeoutMs: number;
}

/** Path segments made of URL-safe characters only: no query, fragment, `..` or `//`. */
const APPLICATION_PATH = /^(?:\/[A-Za-z0-9_-]+)+$/;

function failed(reason: EmailFailureReason, attempts: number): EmailDeliveryResult {
  return { status: 'failed', reason, attempts };
}

/** What is wrong with `message`, or `null` when it may be sent. */
function messageProblem(message: EmailMessage): 'recipient' | 'subject' | 'body' | null {
  if (typeof message !== 'object' || message === null) return 'body';
  if (!isDeliverableAddress(message.to)) return 'recipient';
  if (
    typeof message.subject !== 'string' ||
    message.subject.trim() === '' ||
    message.subject.length > 255 ||
    !isSingleLine(message.subject)
  ) {
    return 'subject';
  }
  if (typeof message.text !== 'string' || message.text.trim() === '') return 'body';
  if (typeof message.html !== 'string' || message.html.trim() === '') return 'body';
  return null;
}

/**
 * One attempt, bounded by `timeoutMs` whatever the transport does. The signal
 * asks the transport to stop; the race guarantees the caller is released even
 * if it does not. Neither a timed-out attempt nor a transport that throws is
 * retryable: how far the message got is unknown.
 */
async function attemptDelivery(
  transport: EmailTransport,
  message: OutgoingEmail,
  timeoutMs: number
): Promise<DeliveryAttempt> {
  const signal = AbortSignal.timeout(timeoutMs);
  const deadline = new Promise<DeliveryAttempt>((resolve) => {
    signal.addEventListener(
      'abort',
      () => resolve({ accepted: false, reason: 'timeout', retryable: false, diagnostics: {} }),
      { once: true }
    );
  });
  const delivery = Promise.resolve()
    .then(() => transport.deliver(message, signal))
    .catch((): DeliveryAttempt => ({
      accepted: false,
      reason: 'unknown',
      retryable: false,
      diagnostics: {},
    }));
  return Promise.race([delivery, deadline]);
}

function logFailure(
  reason: EmailFailureReason,
  attempts: number,
  diagnostics: DeliveryDiagnostics
): void {
  console.error('[email] delivery failed; nothing is recorded as sent', {
    reason,
    attempts,
    ...diagnostics,
  });
}

/**
 * Deliver `message` through `transport`, retrying only failures the transport
 * marked retryable, at most `maxAttempts` times in total.
 */
export async function deliverWithRetry(
  transport: EmailTransport,
  message: OutgoingEmail,
  policy: RetryPolicy
): Promise<EmailDeliveryResult> {
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await attemptDelivery(transport, message, policy.attemptTimeoutMs);
    if (outcome.accepted) {
      return { status: 'sent', messageId: message.messageId, attempts: attempt };
    }

    if (!outcome.retryable || attempt >= policy.maxAttempts) {
      logFailure(outcome.reason, attempt, outcome.diagnostics);
      return failed(outcome.reason, attempt);
    }
    await sleep(policy.retryDelayMs * 2 ** (attempt - 1));
  }
}

/**
 * Send one transactional message.
 *
 * Returns `disabled` when delivery is switched off (the default), `sent` once
 * the mail server has accepted the message, and `failed` with a reason
 * otherwise. `failed` and `disabled` both mean the recipient has not been sent
 * anything by this call.
 */
export async function sendEmail(
  compose: ComposeEmail,
  options: SendEmailOptions = {}
): Promise<EmailDeliveryResult> {
  try {
    const config = loadEmailConfig(options.env ?? process.env);
    if (config.mode === 'disabled') return { status: 'disabled' };
    if (config.mode === 'invalid') {
      console.error('[email] delivery is enabled but misconfigured; nothing was sent', {
        problems: config.problems,
      });
      return failed('configuration', 0);
    }

    const { settings } = config;

    let message: EmailMessage;
    try {
      message = compose((path) => {
        if (!APPLICATION_PATH.test(path)) throw new Error('Invalid application path');
        return `${settings.appUrl}${path}`;
      });
    } catch {
      console.error('[email] the message could not be composed; nothing was sent');
      return failed('invalid_message', 0);
    }

    const problem = messageProblem(message);
    if (problem) {
      console.error('[email] refused to send an invalid message', { problem });
      return failed('invalid_message', 0);
    }

    // Not logged here: the budget's owner knows which limit was hit and says so.
    if (options.reserve && !(await options.reserve())) {
      return failed('rate_limited', 0);
    }

    const [, senderDomain] = settings.from.address.split('@');
    return await deliverWithRetry(
      createSmtpTransport(settings.smtp),
      {
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        from: settings.from,
        ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
        messageId: `<${randomUUID()}@${senderDomain}>`,
      },
      {
        maxAttempts: settings.maxAttempts,
        retryDelayMs: settings.retryDelayMs,
        attemptTimeoutMs: settings.smtp.attemptTimeoutMs,
      }
    );
  } catch (error) {
    // Nothing above is expected to throw. If something does - the limiter's
    // store being unreachable, for one - the caller still gets an answer that
    // is not "sent", and the log gets the error's type, never its text.
    console.error('[email] unexpected failure; the message is not recorded as sent', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return failed('unknown', 0);
  }
}
