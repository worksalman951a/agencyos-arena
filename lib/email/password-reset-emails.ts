import 'server-only';

import { reservePasswordResetEmail } from '@/lib/email/sending-limit';
import { sendEmail } from '@/lib/email/mailer';
import { passwordResetEmail } from '@/lib/email/templates';
import type { EmailDeliveryResult } from '@/lib/email/types';

/**
 * Password-reset e-mail.
 *
 * This module sends; it does not authorize and does not decide whether an
 * account may recover. The caller has already applied the account-status rule
 * and has already stored the token hash.
 *
 * `resetPath` contains the raw token. It is used to build the link inside the
 * message and for nothing else: it is not logged and not part of the returned
 * result. The delivery outcome is reported exactly as `sendEmail` observed it -
 * SMTP acceptance is not treated as proof that the mailbox belongs to the
 * account holder, and nothing about the account is marked verified here.
 *
 * Not a `'use server'` module, so it can never be reached as a server action.
 */
export function sendPasswordResetEmail(input: {
  to: string;
  resetPath: string;
  expiresAt: Date;
}): Promise<EmailDeliveryResult> {
  return sendEmail(
    (link) => ({
      to: input.to,
      ...passwordResetEmail({
        resetUrl: link(input.resetPath),
        expiresAt: input.expiresAt,
      }),
    }),
    {
      reserve: () => reservePasswordResetEmail({ recipient: input.to }),
    }
  );
}
