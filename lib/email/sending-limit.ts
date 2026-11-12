import 'server-only';

import {
  consumeRateLimit,
  rateLimitKey,
  RATE_LIMITS,
  type RateLimitPolicy,
} from '@/lib/security/rate-limit';

/**
 * How much password-reset e-mail may leave this deployment.
 *
 * A reset message goes to an address the caller typed, so it is a second way
 * to make the mail server write to anyone. Two budgets are charged at the
 * moment a message is really about to be sent (delivery enabled, configuration
 * valid, message valid), narrowest first:
 *
 *  1. per recipient - one mailbox cannot be flooded from many client addresses
 *                      or by repeated requests;
 *  2. per deployment - a ceiling on total reset mail.
 *
 * Exhausting a budget never changes the HTTP answer: the response is the same
 * "if an account exists..." message, and the prepared token is invalidated
 * because no message was sent.
 */
export async function reservePasswordResetEmail(input: { recipient: string }): Promise<boolean> {
  const budgets: Array<[RateLimitPolicy, string]> = [
    ['password-reset-email-recipient', `recipient:${input.recipient.trim().toLowerCase()}`],
    ['password-reset-email-deployment', 'deployment'],
  ];

  for (const [policy, subject] of budgets) {
    const decision = await consumeRateLimit(rateLimitKey(policy, subject), RATE_LIMITS[policy]);
    if (!decision.allowed) {
      console.error('[email] password reset e-mail limit reached; the message was not sent', {
        policy,
      });
      return false;
    }
  }
  return true;
}

/**
 * How much invitation e-mail may leave this deployment.
 *
 * An invitation e-mail goes to an address the caller chose, so without a limit
 * the feature is a way to make the mail server write to anyone. Three budgets
 * are checked, narrowest first, in the shared limiter store (PostgreSQL), so
 * every application instance counts against the same numbers:
 *
 *  1. per recipient    - one address cannot be flooded by inviting, revoking
 *                        and inviting again, from one organization or several;
 *  2. per organization - a tenant cannot use the deployment as a bulk mailer.
 *                        Keyed on the organization, not the session, so signing
 *                        in again does not buy a second budget;
 *  3. per deployment   - a ceiling on what a caller who registers many
 *                        organizations can make the mail server send.
 *
 * The first budget that is exhausted stops the check, so a caller who is
 * already over a narrow limit cannot spend the wider ones for everybody else.
 *
 * This limits e-mail only. An invitation that is refused here is still created
 * and its link is still handed to the administrator; it is just not e-mailed,
 * and the delivery result says so.
 */
export async function reserveInvitationEmail(input: {
  organizationId: string;
  recipient: string;
}): Promise<boolean> {
  const budgets: Array<[RateLimitPolicy, string]> = [
    ['invitation-email-recipient', `recipient:${input.recipient.trim().toLowerCase()}`],
    ['invitation-email-organization', `organization:${input.organizationId}`],
    ['invitation-email-deployment', 'deployment'],
  ];

  for (const [policy, subject] of budgets) {
    // The subject is hashed into the bucket key; no address is stored.
    const decision = await consumeRateLimit(rateLimitKey(policy, subject), RATE_LIMITS[policy]);
    if (!decision.allowed) {
      // Which limit, never whose: an operator needs to tell one flooded address
      // from a deployment-wide ceiling being hit.
      console.error('[email] invitation e-mail limit reached; the message was not sent', {
        policy,
      });
      return false;
    }
  }
  return true;
}
