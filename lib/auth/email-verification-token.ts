import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import {
  EMAIL_VERIFICATION_IDENTIFIER_PREFIX,
  EMAIL_VERIFICATION_TOKEN_BYTES,
} from '@/lib/auth/email-verification-policy';

export interface EmailVerificationToken {
  /** Bearer credential. Retained in process memory only until SMTP composition. */
  token: string;
  /** Namespaced SHA-256 digest suitable for storage. */
  identifier: string;
}

export function emailVerificationIdentifier(token: string): string {
  return `${EMAIL_VERIFICATION_IDENTIFIER_PREFIX}${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

export function createEmailVerificationToken(): EmailVerificationToken {
  const token = randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString('base64url');
  return { token, identifier: emailVerificationIdentifier(token) };
}
