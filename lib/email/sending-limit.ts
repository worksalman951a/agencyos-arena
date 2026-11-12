import 'server-only';

import {
  consumeRateLimit,
  rateLimitKey,
  RATE_LIMITS,
  type RateLimitPolicy,
} from '@/lib/security/rate-limit';

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
