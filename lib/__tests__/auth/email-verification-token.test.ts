import { describe, expect, it } from 'vitest';
import {
  EMAIL_VERIFICATION_IDENTIFIER_PREFIX,
  EMAIL_VERIFICATION_TTL_SECONDS,
  isEmailVerificationToken,
} from '@/lib/auth/email-verification-policy';
import {
  createEmailVerificationToken,
  emailVerificationIdentifier,
} from '@/lib/auth/email-verification-token';

describe('email ownership verification tokens', () => {
  it('mints 256-bit URL-safe tokens and stores only a namespaced digest', () => {
    const first = createEmailVerificationToken();
    const second = createEmailVerificationToken();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isEmailVerificationToken(first.token)).toBe(true);
    expect(first.identifier).toMatch(
      new RegExp(`^${EMAIL_VERIFICATION_IDENTIFIER_PREFIX}[a-f0-9]{64}$`)
    );
    expect(first.identifier).not.toContain(first.token);
    expect(emailVerificationIdentifier(first.token)).toBe(first.identifier);
    expect(second.token).not.toBe(first.token);
    expect(isEmailVerificationToken('short')).toBe(false);
    expect(EMAIL_VERIFICATION_TTL_SECONDS).toBe(1800);
  });
});
