import 'server-only';

/**
 * Secure password recovery (Phase 4D / Batch 4B).
 *
 * What is reused from Better Auth, rather than reimplemented:
 *  - the `Verification` table (no new token table, no migration);
 *  - `internalAdapter.createVerificationValue` to store a token;
 *  - `internalAdapter.consumeVerificationValue`, the vendor's atomic
 *    single-use consume (one statement/row delete; a concurrent second
 *    redeemer gets `null`);
 *  - `password.hash` (Better Auth's Scrypt hasher);
 *  - `internalAdapter.findCredentialAccount`, `updateAccount`,
 *    `createAccount` and `deleteUserSessions`.
 *
 * What is deliberately not used, and why:
 *  - `POST /api/auth/request-password-reset` stores the raw token in
 *    `Verification.identifier` (`reset-password:<token>`). This application
 *    treats a reset token like an invitation token: only its SHA-256 hash may
 *    be at rest. The request route therefore mints the token itself and stores
 *    `password-reset:<sha256(token)>`.
 *  - Better Auth's `/api/auth/reset-password` endpoint would only find rows
 *    whose identifier uses its `reset-password:` prefix. Our rows use a
 *    different namespace, so that endpoint cannot redeem them even if the
 *    stored hash leaked. It stays enabled but is inert because no
 *    `sendResetPassword` hook is configured.
 *
 * Security properties:
 *  - The raw token exists only in the request that mints it and in the
 *    e-mail; it is never written to the database, a log or a response body.
 *  - Tokens expire after 30 minutes and can be redeemed exactly once.
 *  - Requesting a new link invalidates the account's earlier unused links.
 *  - A successful reset revokes every session for the account, so a stolen
 *    cookie cannot outlive the password change.
 *  - Suspended, removed and revoked accounts can neither receive nor redeem a
 *    link; the status check is repeated at redemption time.
 *  - Requesting a link for an unknown address answers exactly like a known one.
 */

import { auth } from '@/lib/auth-server';
import { findRecoverableAccount, isAccountIdActive } from '@/lib/auth/account-eligibility';
import {
  PASSWORD_RESET_IDENTIFIER_PREFIX,
  PASSWORD_RESET_PATH_PREFIX,
  PASSWORD_RESET_TTL_SECONDS,
  isPasswordResetToken,
  passwordPolicyError,
} from '@/lib/auth/password-reset-policy';
import { createPasswordResetToken, passwordResetIdentifier } from '@/lib/auth/password-reset-token';
import { prisma } from '@/lib/db';
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from '@/lib/schemas/auth/password-reset.schema';

/** Anything the caller is allowed to know about a recovery request. */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  'If an account exists for that e-mail address, a password reset link has been sent. Check your inbox and spam folder.';

const INVALID_RESET_TOKEN =
  'This password reset link is invalid or has expired. Request a new one.';

function codedError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * A prepared message. `resetPath` carries the raw token and is handed only to
 * the mailer; it must never be returned from an HTTP handler or logged.
 */
export interface PreparedPasswordReset {
  to: string;
  resetPath: string;
  expiresAt: Date;
  /** Hash-namespaced identifier, so a failed delivery can invalidate the row. */
  identifier: string;
}

/**
 * Mint and persist a reset token for an eligible account.
 *
 * Returns `null` for an unknown, suspended, removed or revoked account. The
 * caller must not turn that into a different HTTP response.
 *
 * The e-mail is *not* sent here: the route hands the returned value to a
 * post-response task, so the response time does not depend on whether the
 * address exists or on how fast (or whether) the SMTP relay answers.
 */
export async function preparePasswordReset(email: string): Promise<PreparedPasswordReset | null> {
  // Resolved before the lookup so a cold start costs the same for a known and
  // an unknown address.
  const context = await auth.$context;

  const account = await findRecoverableAccount(email);
  if (account === null) {
    // Work of the same shape as the real path, so an unknown address is not
    // cheaper by an obvious margin. Nothing is persisted for it.
    createPasswordResetToken();
    await prisma.verification.findFirst({
      where: { identifier: `${PASSWORD_RESET_IDENTIFIER_PREFIX}not-issued` },
      select: { id: true },
    });
    return null;
  }

  const { token, identifier } = createPasswordResetToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);

  // One live link per account: an older, unused link stops working when a new
  // one is requested. This also bounds the rows an authenticated account can
  // accumulate through repeated requests.
  await prisma.verification.deleteMany({
    where: { userId: account.id, identifier: { startsWith: PASSWORD_RESET_IDENTIFIER_PREFIX } },
  });

  // Better Auth's default `Verification` shape has no `userId`; this project's
  // model requires one, so the relation is set explicitly. It is declared as a
  // variable because the vendor's input type does not include the extra column
  // (the adapter passes it through to Prisma).
  const verificationRow = {
    identifier,
    value: account.id,
    userId: account.id,
    expiresAt,
  };
  await context.internalAdapter.createVerificationValue(verificationRow);

  return {
    to: account.email,
    resetPath: `${PASSWORD_RESET_PATH_PREFIX}${token}`,
    expiresAt,
    identifier,
  };
}

/**
 * Remove a prepared token whose message was not accepted by the mail server.
 *
 * Called only for an outcome that is not `sent`: a link nobody received should
 * not stay redeemable. Best effort; failure changes nothing about the caller's
 * answer.
 */
export async function discardPasswordReset(identifier: string): Promise<void> {
  try {
    await prisma.verification.deleteMany({ where: { identifier } });
  } catch (error) {
    console.error('[auth] could not discard an undelivered password reset token', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

/**
 * Redeem a reset token.
 *
 * Validation order matters: the password policy is checked before the token is
 * consumed, so a mistyped short password does not burn a valid link. The token
 * is then consumed atomically; only a non-null result may change the password.
 *
 * Errors carry a `statusCode` for `apiErrorFrom`. Invalid, expired, reused and
 * inactive-account cases share one message and one status.
 */
export async function redeemPasswordReset(input: unknown): Promise<{ status: true }> {
  const parsed = passwordResetConfirmSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const { token, newPassword } = parsed.data;

  const policyError = passwordPolicyError(newPassword);
  if (policyError) throw codedError(policyError, 400);

  if (!isPasswordResetToken(token)) throw codedError(INVALID_RESET_TOKEN, 400);

  const context = await auth.$context;
  const verification = await context.internalAdapter.consumeVerificationValue(
    passwordResetIdentifier(token)
  );
  if (!verification) throw codedError(INVALID_RESET_TOKEN, 400);

  // The account may have been suspended or removed after the link was issued.
  // The token is already spent at this point; refusing is the point.
  if (!(await isAccountIdActive(verification.value))) {
    throw codedError(INVALID_RESET_TOKEN, 400);
  }

  const userId = verification.value;
  const passwordHash = await context.password.hash(newPassword);

  // Revoke first: if the password write then fails, the user keeps the old
  // password and no stale session survives. A failure here leaves the token
  // spent, so the user requests a new link - never a half-completed reset.
  await context.internalAdapter.deleteUserSessions(userId);

  const credential = await context.internalAdapter.findCredentialAccount(userId);
  if (credential) {
    // Update the exact row that was found. `updatePassword` filters on
    // providerId/accountId as well; using the primary key avoids a silent
    // no-op if an older row has a different accountId.
    await context.internalAdapter.updateAccount(credential.id, { password: passwordHash });
  } else {
    await context.internalAdapter.createAccount({
      userId,
      providerId: 'credential',
      accountId: userId,
      password: passwordHash,
    });
  }

  // Any other outstanding link for this account dies with the reset.
  await prisma.verification.deleteMany({
    where: { userId, identifier: { startsWith: PASSWORD_RESET_IDENTIFIER_PREFIX } },
  });

  return { status: true };
}

/** Validate the shape of a recovery request. Pure; used by the route. */
export function parsePasswordResetRequest(input: unknown) {
  return passwordResetRequestSchema.safeParse(input);
}
