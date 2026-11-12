/**
 * What an administrator is told about an invitation e-mail (pure module, safe
 * to import from a client component).
 *
 * The wording follows one rule: the interface says an e-mail was sent only when
 * the API reported exactly `sent`. A failure says so and tells the administrator
 * to hand the link over; anything else - delivery switched off, or a response
 * that does not carry the field - produces no notice at all.
 */

export interface DeliveryNotice {
  tone: 'success' | 'warning';
  text: string;
}

const SHARE_LINK = 'Share the link below with the client yourself.';

export function invitationEmailNotice(
  delivery: unknown,
  recipient?: unknown
): DeliveryNotice | null {
  if (typeof delivery !== 'object' || delivery === null) return null;
  const { status, reason } = delivery as { status?: unknown; reason?: unknown };

  if (status === 'sent') {
    const to = typeof recipient === 'string' && recipient ? ` to ${recipient}` : '';
    return { tone: 'success', text: `The invitation was e-mailed${to}.` };
  }

  if (status === 'failed') {
    if (reason === 'rate_limited') {
      return {
        tone: 'warning',
        text: `The invitation was not e-mailed: the hourly sending limit has been reached. ${SHARE_LINK}`,
      };
    }
    if (reason === 'rejected') {
      return {
        tone: 'warning',
        text: `The invitation was not e-mailed: the mail server refused it. Check the address, or share the link below with the client yourself.`,
      };
    }
    return { tone: 'warning', text: `The invitation could not be e-mailed. ${SHARE_LINK}` };
  }

  return null;
}
