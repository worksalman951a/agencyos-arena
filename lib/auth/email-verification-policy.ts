/**
 * Ownership-verification policy. Verification remains advisory for sign-in:
 * existing users are not locked out during rollout. Portal invitation linking
 * is the one workflow that requires proof of mailbox ownership.
 */
export const EMAIL_VERIFICATION_TTL_SECONDS = 30 * 60;
export const EMAIL_VERIFICATION_TOKEN_BYTES = 32;
export const EMAIL_VERIFICATION_IDENTIFIER_PREFIX = 'email-ownership:';
export const EMAIL_VERIFICATION_REQUEST_MESSAGE =
  'If an active account uses that address and needs verification, an email will be sent.';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isEmailVerificationToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}
