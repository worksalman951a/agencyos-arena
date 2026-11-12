/**
 * Password-recovery policy (pure module: no I/O, no database, no framework).
 *
 * Kept separate from the service so the route handlers, the e-mail templates
 * and the tests all read the same numbers. Nothing here is configurable at
 * runtime: a recovery link that lives longer than half an hour, or a password
 * shorter than eight characters, is a policy change, not a deployment knob.
 *
 * Why 30 minutes: the link is a bearer credential in a mailbox. It is long
 * enough for a person to open their mail and act, and short enough that a
 * forgotten inbox is not a long-lived way in. Better Auth's default (one hour)
 * is not used; `emailAndPassword.resetPasswordTokenExpiresIn` is set to this
 * value so the vendor's own endpoint, if it is ever enabled, cannot outlive it.
 */

/** How long a reset link stays redeemable. */
export const PASSWORD_RESET_TTL_SECONDS = 30 * 60;

/** Entropy of a reset token: 32 bytes -> 256 bits. */
export const PASSWORD_RESET_TOKEN_BYTES = 32;

/**
 * Namespace for the stored `Verification.identifier`.
 *
 * Deliberately *not* `reset-password:`: that is the prefix Better Auth's own
 * `/reset-password` endpoint looks up, and it looks the value up by the raw
 * token. Using a different prefix means the vendor endpoint can never consume
 * one of our hashed rows, even if a database leak exposed the hash.
 */
export const PASSWORD_RESET_IDENTIFIER_PREFIX = 'password-reset:';

/** The path the e-mailed link points at. The raw token is the last segment. */
export const PASSWORD_RESET_PATH_PREFIX = '/reset-password/';

/** Better Auth's default minimum, stated explicitly so reset and sign-up agree. */
export const PASSWORD_MIN_LENGTH = 8;

/** Better Auth's default maximum, stated explicitly so reset and sign-up agree. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * 32 random bytes in base64url are exactly 43 URL-safe characters. Validating
 * the shape before touching the database keeps an 8 KB body from becoming an
 * 8 KB lookup key and makes malformed tokens a cheap rejection.
 */
const PASSWORD_RESET_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** `true` when `value` has the exact shape of a token this application mints. */
export function isPasswordResetToken(value: unknown): value is string {
  return typeof value === 'string' && PASSWORD_RESET_TOKEN.test(value);
}

/**
 * The one password policy applied by the reset flow. Returns a message safe to
 * show to the user, or `null` when the password is acceptable.
 *
 * The checks mirror Better Auth's `minPasswordLength` / `maxPasswordLength`
 * (configured to these constants in `lib/auth-server.ts`) so a password the
 * reset accepts is one sign-in understands afterwards.
 */
export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'A password is required.';
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (password.trim().length === 0) {
    return 'A password is required.';
  }
  return null;
}
