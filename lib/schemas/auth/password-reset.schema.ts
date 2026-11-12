/**
 * Password-recovery request validation (pure module).
 *
 * Strict schemas: a recovery request carries an e-mail address and nothing
 * else. In particular there is no `redirectTo` / `callbackUrl` field, so a
 * caller cannot choose where a successful reset sends the browser - the only
 * destination is the fixed sign-in page.
 */

import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .normalize()
  .toLowerCase()
  .email('A valid e-mail address is required')
  .max(200);

export const passwordResetRequestSchema = z.object({ email: emailSchema }).strict();

export const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(1, 'A reset token is required').max(200),
    // Bounds are enforced by `passwordPolicyError`, which runs before the
    // token is spent and returns a user-facing message. A `.max()` here would
    // turn an over-long password into a generic 400 before that check.
    newPassword: z.string().min(1, 'A password is required'),
  })
  .strict();

export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
