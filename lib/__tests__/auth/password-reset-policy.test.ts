// @vitest-environment node

/**
 * Password-recovery policy (`lib/auth/password-reset-policy.ts`).
 *
 * Pure properties only: token shape/entropy, the hash used as the stored
 * identifier, and the password rule the reset endpoint and Better Auth share.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RESET_IDENTIFIER_PREFIX,
  PASSWORD_RESET_TTL_SECONDS,
  isPasswordResetToken,
  passwordPolicyError,
} from '@/lib/auth/password-reset-policy';
import { createPasswordResetToken, passwordResetIdentifier } from '@/lib/auth/password-reset-token';

describe('password reset tokens', () => {
  it('mints a 256-bit, URL-safe, single-segment token', () => {
    const { token } = createPasswordResetToken();

    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createPasswordResetToken().token));
    expect(tokens.size).toBe(200);
  });

  it('stores a namespaced SHA-256 of the token, never the token itself', () => {
    const { token, identifier } = createPasswordResetToken();
    const digest = createHash('sha256').update(token, 'utf8').digest('hex');

    expect(identifier).toBe(`${PASSWORD_RESET_IDENTIFIER_PREFIX}${digest}`);
    expect(identifier).toHaveLength(PASSWORD_RESET_IDENTIFIER_PREFIX.length + 64);
    expect(identifier).not.toContain(token);
    expect(passwordResetIdentifier(token)).toBe(identifier);
  });

  it("uses a namespace Better Auth's restore endpoint does not look up", () => {
    // The vendor endpoint prefixes the *raw* token with `reset-password:`.
    // Using another prefix is what stops a leaked hash from being replayed
    // against it.
    expect(PASSWORD_RESET_IDENTIFIER_PREFIX).not.toBe('reset-password:');
  });

  it('expires links after half an hour', () => {
    expect(PASSWORD_RESET_TTL_SECONDS).toBe(1800);
  });
});

describe('isPasswordResetToken', () => {
  it('accepts only exactly 43 URL-safe characters', () => {
    expect(isPasswordResetToken(createPasswordResetToken().token)).toBe(true);

    for (const candidate of [
      '',
      'short',
      'a'.repeat(42),
      'a'.repeat(44),
      'a'.repeat(43) + '/',
      'a'.repeat(42) + '+',
      'a'.repeat(42) + '=',
      'a'.repeat(42) + ' ',
      'a'.repeat(42) + '\n',
      null,
      undefined,
      123,
      {},
    ]) {
      expect(isPasswordResetToken(candidate), String(candidate)).toBe(false);
    }
  });
});

describe('passwordPolicyError', () => {
  it('accepts the shortest and longest allowed password', () => {
    expect(passwordPolicyError('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(passwordPolicyError('a'.repeat(PASSWORD_MAX_LENGTH))).toBeNull();
  });

  it('rejects a missing, empty or whitespace-only password', () => {
    for (const value of [undefined, null, '', '        ', 123, {}]) {
      expect(passwordPolicyError(value)).not.toBeNull();
    }
  });

  it('rejects a password below the minimum', () => {
    expect(passwordPolicyError('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
    );
  });

  it('rejects a password above the maximum', () => {
    expect(passwordPolicyError('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe(
      `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`
    );
  });

  it("matches Better Auth's documented bounds", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });
});
