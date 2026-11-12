import 'server-only';

import { reserveEmailVerificationEmail } from '@/lib/email/sending-limit';
import { sendEmail } from '@/lib/email/mailer';
import { emailOwnershipVerificationEmail } from '@/lib/email/templates';
import type { EmailDeliveryResult } from '@/lib/email/types';

/** Sends a one-time ownership link. Tokens are only placed in the URL fragment,
 * which browsers never send to the server in a request or Referer header. */
export function sendEmailVerificationEmail(input: {
  to: string;
  token: string;
  expiresAt: Date;
}): Promise<EmailDeliveryResult> {
  return sendEmail(
    (link) => ({
      to: input.to,
      ...emailOwnershipVerificationEmail({
        verificationUrl: `${link('/verify-email')}#${encodeURIComponent(input.token)}`,
        expiresAt: input.expiresAt,
      }),
    }),
    { reserve: () => reserveEmailVerificationEmail({ recipient: input.to }) }
  );
}
