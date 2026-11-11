/**
 * Current-request identity helpers for Server Components.
 *
 * These resolve the Better Auth session and the actor's permission codes for
 * their organization. Both are wrapped in React's `cache`, so a layout and a
 * page that each need them share a single database round-trip per request —
 * and nothing is shared between requests.
 *
 * Authorization itself is never decided here: this only answers "who is this
 * and what may they do", so the UI can avoid offering actions that the service
 * layer would reject with 403.
 */

import { cache } from 'react';
import { cookies } from 'next/headers';

import { auth } from '@/lib/auth-server';
import { prisma } from '@/lib/db';
import { getUserPermissions, requireOrganization } from '@/lib/permissions';

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  /**
   * "internal" (team member) or "client" (client-portal identity).
   *
   * The Better Auth session payload does not include this column, so it is read
   * from the database here — once per request, thanks to `cache`. The module
   * shell uses it to keep client sessions out of the internal application.
   */
  userType: 'internal' | 'client';
}

/** The signed-in user, or null when there is no valid session. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) return null;

  const user = result.user as { id: string; name?: string | null; email?: string | null };

  const identity = await prisma.user.findUnique({
    where: { id: user.id },
    select: { userType: true },
  });

  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    userType: identity?.userType === 'client' ? 'client' : 'internal',
  };
});

/**
 * Permission codes for the signed-in user within their organization.
 *
 * Returns an empty set for a member without an organization (bootstrap not
 * completed). Any other failure — a database outage, for instance — is
 * re-thrown rather than hidden, so it cannot silently read as "no permissions".
 */
export const getCurrentPermissions = cache(async (): Promise<ReadonlySet<string>> => {
  const user = await getSessionUser();
  if (!user) return new Set<string>();

  try {
    const { organizationId } = await requireOrganization(user.id);
    return await getUserPermissions(user.id, organizationId);
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: no organization') {
      return new Set<string>();
    }
    throw error;
  }
});
