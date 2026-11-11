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
 * Require organization membership; throws if the user has no org.
 *
 * Client-portal identities (`userType = "client"`) are rejected here even if a
 * row somehow carries an organization id. That makes this function the single
 * place that guarantees a client session can never satisfy an internal
 * organization check — see lib/portal/access-control.ts for the client-side
 * equivalent.
 */
export async function requireOrganization(userId: string): Promise<{ organizationId: string }> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, userType: true },
  })) as { organizationId: string | null; userType?: string } | null;
  if (!user || user.userType === 'client' || !user.organizationId) {
    const error = new Error('Forbidden: no organization') as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }
  return { organizationId: user.organizationId };
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
