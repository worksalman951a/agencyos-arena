/**
 * Internal (team) actor resolution for portal administration services.
 *
 * Client identities must never reach these services: because they have no
 * organization membership, `requireOrganization` already fails for them, and the
 * explicit `userType` check below makes the intent impossible to miss.
 */

import { cookies } from 'next/headers';

import { auth } from '@/lib/auth-server';
import { prisma } from '@/lib/db';
import { requireOrganization, requirePermission, type AuthorizedUser } from '@/lib/permissions';
import { codedError } from '@/lib/portal/access-control';

export interface InternalActor extends AuthorizedUser {
  organizationId: string;
}

/**
 * Resolve the signed-in team member, optionally requiring a permission code.
 *
 * Throws 401 without a session, 403 for a client identity or a missing
 * permission.
 */
export async function requireInternalActor(permission?: string): Promise<InternalActor> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    throw codedError('Unauthenticated', 401);
  }

  const identity = await prisma.user.findUnique({
    where: { id: result.user.id },
    select: { userType: true },
  });

  // A client-portal identity is a different kind of principal entirely.
  if (identity?.userType === 'client') {
    throw codedError('Forbidden', 403);
  }

  const { organizationId } = await requireOrganization(result.user.id);
  if (permission) {
    await requirePermission(result.user.id, organizationId, permission);
  }

  const user = result.user as { role?: string };
  return {
    userId: result.user.id,
    organizationId,
    email: (result.user.email ?? '').toLowerCase(),
    role: user.role ?? 'employee',
  };
}
