import 'server-only';

import { sendEmail } from '@/lib/email/mailer';
import { reserveInvitationEmail } from '@/lib/email/sending-limit';
import { clientInvitationEmail } from '@/lib/email/templates';
import type { EmailDeliveryResult } from '@/lib/email/types';

/**
 * Invitation e-mails.
 *
 * This module sends; it does not authorize. A caller must already have checked
 * the session, the permission and the organization scope, and must already have
 * stored the invitation - the service in `lib/services` calls it as its last
 * step, with values read from its own organization-scoped records. It is
 * intentionally not a `'use server'` module, so it can never be reached as a
 * server action.
 *
 * `acceptPath` contains the raw invitation token. It is used to build the link
 * inside the message and for nothing else: it is not logged, and it is not part
 * of the returned result.
 */

export interface ClientInvitationDelivery {
  /** The inviting organization: the session's organization, never a client-supplied id. */
  organizationId: string;
  /** Display name of that organization. */
  organizationName: string;
  /** The invited address, exactly as stored on the invitation. */
  to: string;
  /** The invited contact's first name, when known. */
  recipientName?: string | null;
  /** Path of the acceptance page including the raw token: `/portal/invite/<token>`. */
  acceptPath: string;
  expiresAt: Date;
}

/** E-mail a client-portal invitation to the invited contact. */
export function sendClientInvitationEmail(
  input: ClientInvitationDelivery
): Promise<EmailDeliveryResult> {
  return sendEmail(
    (link) => ({
      to: input.to,
      ...clientInvitationEmail({
        organizationName: input.organizationName,
        recipientName: input.recipientName,
        acceptUrl: link(input.acceptPath),
        expiresAt: input.expiresAt,
      }),
    }),
    {
      reserve: () =>
        reserveInvitationEmail({ organizationId: input.organizationId, recipient: input.to }),
    }
  );
}
