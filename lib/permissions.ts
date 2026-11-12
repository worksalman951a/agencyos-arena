/**
 * AgencyOS permission utilities (ADR-0004).
 *
 * Server-side authorization helpers. Every check is performed against the
 * database; the frontend never enforces authorization.
 *
 * Model:
 * - Organization scoping: every query filters WHERE organizationId = actor.orgId
 * - Role-based: endpoint requires permission codes (userRoles -> rolePermissions)
 * - Resource ownership: users mutate only records they own/are assigned to
 * - Client scoping: clients read only their own linked records
 */

import { prisma } from '@/lib/db';

/**
 * The only user status that permits authentication or authorization.
 *
 * Suspension sets `status = "suspended"`. Removal is represented by clearing the
 * organization link *and* setting the status to `suspended` — the user row (and
 * its login) survives, so suspension and removal are not the same operation, but
 * both leave the account inactive. Requiring the active status therefore covers
 * suspended and removed members alike. Invited-but-not-yet-accepted accounts keep
 * `status = "active"` so they can still sign in to accept their invitation.
 */
export const ACTIVE_USER_STATUS = 'active';

/**
 * Pure predicate: is this account an internal user allowed to authenticate or
 * act? Client-portal identities are never internal actors.
 */
export function isInternalUserActive(
  user: { userType?: string | null; status?: string | null } | null | undefined
): boolean {
  return (
    user !== null &&
    user !== undefined &&
    user.userType !== 'client' &&
    user.status === ACTIVE_USER_STATUS
  );
}

/**
 * Resolve the permission codes for a user within an organization.
 * Returns a Set of permission code strings.
 */
export async function getUserPermissions(
  userId: string,
  organizationId: string
): Promise<Set<string>> {
  const userRoles = (await prisma.userRole.findMany({
    where: { userId, organizationId },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  })) as Array<{
    role: {
      permissions: Array<{ permission: { code: string } }>;
    };
  }>;

  const permissions = new Set<string>();
  for (const ur of userRoles) {
    for (const rp of ur.role.permissions) {
      permissions.add(rp.permission.code);
    }
  }
  return permissions;
}

/**
 * Check if a user has a specific permission code within an organization.
 */
export async function hasPermission(
  userId: string,
  organizationId: string | undefined,
  permissionCode: string
): Promise<boolean> {
  if (!organizationId) return false;
  const permissions = await getUserPermissions(userId, organizationId);
  return permissions.has(permissionCode);
}

/**
 * Require a permission code; throws if the user lacks it.
 * Route handlers should call this before any mutation.
 */
export async function requirePermission(
  userId: string,
  organizationId: string | undefined,
  permissionCode: string
): Promise<void> {
  const ok = await hasPermission(userId, organizationId, permissionCode);
  if (!ok) {
    const error = new Error('Forbidden: insufficient permissions') as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Require an active internal account with organization membership; throws if the
 * user is missing, is a client-portal identity, is not active, or has no org.
 *
 * Client-portal identities (`userType = "client"`) are rejected here even if a
 * row somehow carries an organization id. That makes this function the single
 * place that guarantees a client session can never satisfy an internal
 * organization check — see lib/portal/access-control.ts for the client-side
 * equivalent.
 *
 * The status check is the server-side enforcement that survives a stale session
 * or cookie: every internal service, page and API resolves its actor through
 * this function, so a suspended or removed member is denied even if a session
 * record created before the suspension is still present in the database.
 */
export async function requireOrganization(userId: string): Promise<{ organizationId: string }> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, userType: true, status: true },
  })) as { organizationId: string | null; userType?: string; status?: string } | null;
  if (!isInternalUserActive(user) || !user!.organizationId) {
    const error = new Error('Forbidden: no organization') as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }
  return { organizationId: user!.organizationId };
}

/**
 * Load an internal account and confirm it is active.
 *
 * Used by entry points that authenticate a session but do not (yet) resolve an
 * organization — for example organization bootstrap, where a removed member
 * with a surviving session could otherwise create a brand-new workspace and
 * re-acquire administrator privileges.
 */
export async function requireActiveInternalUser(userId: string): Promise<void> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: { userType: true, status: true },
  })) as { userType?: string; status?: string } | null;
  if (!isInternalUserActive(user)) {
    const error = new Error('Forbidden: inactive user') as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Type-safe helper for API route handlers.
 * Extracts the authenticated user and organization from the session.
 */
export type AuthorizedUser = {
  userId: string;
  organizationId: string;
  email: string;
  role: string;
};
