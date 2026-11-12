import 'server-only';

/**
 * Reset-token minting and hashing (server-only: uses `node:crypto`).
 *
 * Kept apart from `password-reset-policy.ts` so a client component can import
 * the password bounds and the token shape without pulling Node's crypto module
 * into the browser bundle.
 *
 * The raw token is the only credential; it is never stored. The stored value is
 * a namespaced SHA-256 digest (see `PASSWORD_RESET_IDENTIFIER_PREFIX`), exactly
 * as the invitation flows store a token hash rather than the token.
 */

import { createHash, randomBytes } from 'node:crypto';

import {
  PASSWORD_RESET_IDENTIFIER_PREFIX,
  PASSWORD_RESET_TOKEN_BYTES,
} from '@/lib/auth/password-reset-policy';

export interface PasswordResetToken {
  /** The credential sent to the user's mailbox. Never stored, never logged. */
  token: string;
  /** SHA-256 of `token`, namespaced for the `Verification` table. Safe to store. */
  identifier: string;
}

/** Derive the stored identifier from a raw token. Deterministic. */
export function passwordResetIdentifier(token: string): string {
  const digest = createHash('sha256').update(token, 'utf8').digest('hex');
  return `${PASSWORD_RESET_IDENTIFIER_PREFIX}${digest}`;
}

/** Mint a token and the identifier under which its hash is stored. */
export function createPasswordResetToken(): PasswordResetToken {
  const token = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('base64url');
  return { token, identifier: passwordResetIdentifier(token) };
}
