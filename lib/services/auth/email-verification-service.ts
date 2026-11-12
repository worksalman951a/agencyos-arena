import 'server-only';

import { auth } from '@/lib/auth-server';
import { prisma } from '@/lib/db';
import {
  EMAIL_VERIFICATION_IDENTIFIER_PREFIX,
  EMAIL_VERIFICATION_TTL_SECONDS,
  isEmailVerificationToken,
} from '@/lib/auth/email-verification-policy';
import {
  createEmailVerificationToken,
  emailVerificationIdentifier,
} from '@/lib/auth/email-verification-token';
import { isAccountIdActive } from '@/lib/auth/account-eligibility';
import { emailVerificationConfirmSchema } from '@/lib/schemas/auth/email-verification.schema';
import { codedError } from '@/lib/portal/access-control';

export const INVALID_EMAIL_VERIFICATION = 'This verification link is invalid or has expired.';

export interface PreparedEmailVerification {
  to: string;
  token: string;
  expiresAt: Date;
  identifier: string;
}

/**
 * Create a hash-only, short-lived link for an active unverified identity.
 * Unknown, already verified and inactive accounts all produce `null` and are
 * indistinguishable to the request route.
 */
export async function prepareEmailVerification(
  email: string
): Promise<PreparedEmailVerification | null> {
  const normalized = email.trim().normalize('NFC').toLowerCase();
  const context = await auth.$context;
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, emailVerified: true },
  });

  if (!user || user.emailVerified || !(await isAccountIdActive(user.id))) {
    // Match the ordinary lookup/create shape without persisting anything.
    createEmailVerificationToken();
    await prisma.verification.findFirst({
      where: { identifier: `${EMAIL_VERIFICATION_IDENTIFIER_PREFIX}not-issued` },
      select: { id: true },
    });
    return null;
  }

  const { token, identifier } = createEmailVerificationToken();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000);

  await prisma.verification.deleteMany({
    where: { userId: user.id, identifier: { startsWith: EMAIL_VERIFICATION_IDENTIFIER_PREFIX } },
  });

  // Store the address that received the message as well as the owning id. If
  // the account address changes before redemption, the old mailbox cannot
  // verify the new address.
  const verificationRow = {
    identifier,
    value: JSON.stringify({ userId: user.id, email: user.email }),
    userId: user.id,
    expiresAt,
  };
  await context.internalAdapter.createVerificationValue(verificationRow);

  return { to: user.email, token, expiresAt, identifier };
}

/** Undelivered links are not left live in the database. */
export async function discardEmailVerification(identifier: string): Promise<void> {
  try {
    await prisma.verification.deleteMany({ where: { identifier } });
  } catch (error) {
    console.error('[auth] could not discard an undelivered email verification token', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

/**
 * Consume the hashed token exactly once, re-check account status and the
 * original address, and update only emailVerified. Status and access rows are
 * never changed, so verification cannot reactivate a suspended/revoked user.
 */
export async function redeemEmailVerification(input: unknown): Promise<{ status: true }> {
  const parsed = emailVerificationConfirmSchema.safeParse(input);
  if (!parsed.success || !isEmailVerificationToken(parsed.data.token)) {
    throw codedError(INVALID_EMAIL_VERIFICATION, 400);
  }

  const context = await auth.$context;
  const verification = await context.internalAdapter.consumeVerificationValue(
    emailVerificationIdentifier(parsed.data.token)
  );
  if (!verification) throw codedError(INVALID_EMAIL_VERIFICATION, 400);

  let claim: { userId: string; email: string };
  try {
    const value: unknown = JSON.parse(verification.value);
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof (value as { userId?: unknown }).userId !== 'string' ||
      typeof (value as { email?: unknown }).email !== 'string'
    ) {
      throw new Error('Invalid verification claim');
    }
    claim = value as { userId: string; email: string };
  } catch {
    throw codedError(INVALID_EMAIL_VERIFICATION, 400);
  }

  if (!(await isAccountIdActive(claim.userId))) {
    throw codedError(INVALID_EMAIL_VERIFICATION, 400);
  }

  const updated = await prisma.user.updateMany({
    where: {
      id: claim.userId,
      email: claim.email,
      emailVerified: false,
      status: 'active',
    },
    data: { emailVerified: true },
  });
  if (updated.count !== 1) throw codedError(INVALID_EMAIL_VERIFICATION, 400);

  // A successful link supersedes any other verification link for this identity.
  await prisma.verification.deleteMany({
    where: {
      userId: claim.userId,
      identifier: { startsWith: EMAIL_VERIFICATION_IDENTIFIER_PREFIX },
    },
  });

  return { status: true };
}
