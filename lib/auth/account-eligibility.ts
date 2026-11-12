import 'server-only';

/**
 * Account-status enforcement for authentication and password recovery.
 *
 * One predicate is shared by Better Auth's session-creation hook and the
 * password-reset service so the two cannot drift:
 *
 * - A client-portal identity may authenticate only while its `ClientAccess`
 *   row is `active`. Suspending or revoking access deletes the client's
 *   sessions; this closes re-login and password recovery.
 * - An internal identity may authenticate only while `User.status` is
 *   `active`. Removal clears the organization link *and* sets the status to
 *   `suspended`, so requiring the active status covers suspended and removed
 *   members alike.
 * - A missing user row is never active.
 *
 * Password recovery never changes these fields. It also refuses to issue or
 * redeem a link for an account that is not active *now*, which is the part that
 * stops a link issued before a suspension from being used afterwards.
 */

import { prisma } from '@/lib/db';
import { ACTIVE_USER_STATUS } from '@/lib/permissions';

interface AccountStatus {
  id: string;
  userType?: string | null;
  status?: string | null;
}

/** `true` only when this account may hold a session or recover its password. */
export async function isAccountActive(account: AccountStatus): Promise<boolean> {
  if (account.userType === 'client') {
    // Both halves matter: the portal access row must be active *and* the
    // underlying login must not be suspended. This matches
    // `requirePortalAccess` (lib/portal/access-control.ts), which checks both.
    if (account.status !== ACTIVE_USER_STATUS) return false;
    const access = await prisma.clientAccess.findFirst({
      where: { userId: account.id },
      select: { status: true },
    });
    return access?.status === 'active';
  }

  return account.status === ACTIVE_USER_STATUS;
}

/** Look up an identity by id and apply the shared status rule. */
export async function isAccountIdActive(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, userType: true, status: true },
  });
  if (!user) return false;
  return isAccountActive(user);
}

export interface RecoverableAccount {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Find the account a reset link may be sent to.
 *
 * The address is normalized the same way Better Auth normalizes it on sign-up
 * and sign-in (trimmed, lower-cased, NFC), so a recovery request matches the
 * identity that actually signs in. Returns `null` for an unknown or inactive
 * account - the caller must answer both cases identically.
 */
export async function findRecoverableAccount(email: string): Promise<RecoverableAccount | null> {
  const normalized = email.trim().normalize('NFC').toLowerCase();
  if (normalized === '') return null;

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, name: true, userType: true, status: true },
  });
  if (!user) return null;
  if (!(await isAccountActive(user))) return null;

  return { id: user.id, email: user.email, name: user.name };
}
