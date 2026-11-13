'use server';

/**
 * Administration: organization members.
 *
 * Defects this replaces (all security-relevant):
 * - `updateUser` accepted any `role` string, so a caller with `user.update`
 *   could type "admin" into the request body and escalate. Roles are now
 *   validated against the roles that actually exist in the caller's
 *   organization and assigned through `UserRole`.
 * - No audit entry was written for a role or status change.
 * - A caller could change their own role/status (removing the last
 *   administrator, or locking themselves out); that is now refused.
 * - The last active administrator cannot be demoted or suspended.
 * - `deleteUser` was declared in the permission list but never implemented.
 */

import { prisma } from '@/lib/db';
import {
  getUserPermissions,
  requirePermission,
  requireOrganization,
  type AuthorizedUser,
} from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { adminUserUpdateSchema } from '@/lib/schemas/admin/member.schema';

export interface UserResponse {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  role: string;
  /** Role names assigned in this organization, for the member list. */
  roles: string[];
  status: string;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function codedError(message: string, statusCode: number, issues?: unknown) {
  const error = new Error(message) as Error & { statusCode: number; issues?: unknown };
  error.statusCode = statusCode;
  if (issues) error.issues = issues;
  return error;
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    throw codedError('Unauthenticated', 401);
  }

  const user = result.user as { role?: string; organizationId?: string };
  const { organizationId } = await requireOrganization(result.user.id);
  return {
    userId: result.user.id,
    organizationId,
    email: result.user.email ?? '',
    role: user.role ?? 'employee',
  };
}

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  role: string;
  status: string;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function serialize(user: UserRecord, roles: string[]): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    emailVerified: user.emailVerified,
    role: user.role,
    roles,
    status: user.status,
    organizationId: user.organizationId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function listUsers() {
  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'user.read');

  const users = await prisma.user.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });

  const memberships = await prisma.userRole.findMany({
    where: { organizationId },
    include: { role: { select: { name: true } } },
  });

  const rolesByUser = new Map<string, string[]>();
  for (const membership of memberships as Array<{ userId: string; role: { name: string } }>) {
    const list = rolesByUser.get(membership.userId) ?? [];
    list.push(membership.role.name);
    rolesByUser.set(membership.userId, list);
  }

  return (users as UserRecord[]).map((user) => serialize(user, rolesByUser.get(user.id) ?? []));
}

export async function getUser(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'user.read');

  const user = await prisma.user.findFirst({ where: { id, organizationId } });
  if (!user) throw codedError('Not found', 404);

  const memberships = await prisma.userRole.findMany({
    where: { userId: id, organizationId },
    include: { role: { select: { name: true } } },
  });

  return serialize(
    user as UserRecord,
    (memberships as Array<{ role: { name: string } }>).map((m) => m.role.name)
  );
}

/** How many active members currently hold the organization's administrator role. */
async function activeAdministratorCount(
  organizationId: string,
  excludeUserId?: string,
  db: typeof prisma = prisma
) {
  const admins = await db.userRole.findMany({
    where: {
      organizationId,
      role: { isSystem: true, name: 'Administrator' },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { userId: true },
  });
  const ids = Array.from(new Set((admins as Array<{ userId: string }>).map((a) => a.userId)));
  if (ids.length === 0) return 0;
  const active = await db.user.count({
    where: { id: { in: ids }, organizationId, status: 'active' },
  });
  return active;
}

async function assertRoleAssignable(roleId: string, organizationId: string, actorId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId },
    include: { permissions: { include: { permission: { select: { code: true } } } } },
  });
  if (!role) throw codedError('Role not found in this organization', 404);

  const actorPermissions = await getUserPermissions(actorId, organizationId);
  const escalation = role.permissions
    .map((entry: { permission: { code: string } }) => entry.permission.code)
    .filter((code: string) => !actorPermissions.has(code));
  if (escalation.length)
    throw codedError('You cannot assign a role with permissions you do not hold', 403);
}

export async function updateUser(id: string, input: unknown) {
  const parsed = adminUserUpdateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400, parsed.error.issues);

  const { userId: actorId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(actorId, organizationId, 'user.update');

  const existing = await prisma.user.findFirst({ where: { id, organizationId } });
  if (!existing) throw codedError('Not found', 404);

  // Self-service privileged changes are refused: an administrator must not be
  // able to demote or suspend themselves into a locked-out workspace.
  if (id === actorId) {
    throw codedError('You cannot change your own role or status', 400);
  }

  if (parsed.data.roleId) {
    await assertRoleAssignable(parsed.data.roleId, organizationId, actorId);
  }

  const willBeSuspended = parsed.data.status !== undefined && parsed.data.status !== 'active';

  const updated = await prisma.$transaction(async (tx: typeof prisma) => {
    // Serialize all membership/status changes within this organization so two
    // concurrent admin removals cannot both observe the other as a survivor.
    await tx.$queryRawUnsafe(
      'SELECT id FROM "Organization" WHERE id = $1 FOR UPDATE',
      organizationId
    );
    const current = await tx.user.findFirst({
      where: { id, organizationId },
      select: { id: true, role: true, status: true, name: true, image: true },
    });
    if (!current) throw codedError('Not found', 404);
    const currentAdmin = await tx.userRole.findFirst({
      where: { userId: id, organizationId, role: { isSystem: true, name: 'Administrator' } },
      select: { roleId: true },
    });
    const losesAdmin =
      currentAdmin &&
      (willBeSuspended ||
        (parsed.data.roleId !== undefined && parsed.data.roleId !== currentAdmin.roleId));
    if (losesAdmin && (await activeAdministratorCount(organizationId, id, tx)) === 0) {
      throw codedError('The organization must keep at least one active administrator', 400);
    }

    const user = await tx.user.update({
      where: { id },
      data: {
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.displayName !== undefined ? { name: parsed.data.displayName } : {}),
        ...(parsed.data.avatarUrl !== undefined ? { image: parsed.data.avatarUrl } : {}),
      },
    });

    if (parsed.data.roleId) {
      await tx.userRole.deleteMany({ where: { userId: id, organizationId } });
      await tx.userRole.create({
        data: {
          userId: id,
          roleId: parsed.data.roleId,
          organizationId,
          assignedBy: actorId,
        },
      });
    }

    // Leaving the active state revokes every live session in the same
    // transaction: a suspended member must not keep working through a cookie
    // issued before the change. Reactivation never restores these sessions, so
    // the member signs in again after being reinstated. The status is also
    // re-checked per request in requireOrganization, which closes the race
    // between this write and a request already in flight.
    if (parsed.data.status !== undefined && parsed.data.status !== 'active') {
      await tx.session.deleteMany({ where: { userId: id } });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        actorName: actorEmail,
        action:
          parsed.data.status !== undefined
            ? 'user.status_changed'
            : parsed.data.roleId !== undefined
              ? 'user.role_changed'
              : 'user.profile_changed',
        entityType: 'User',
        entityId: id,
        before: {
          role: current.role,
          status: current.status,
          name: current.name,
          image: current.image,
        },
        after: {
          role: user.role,
          status: user.status,
          name: user.name,
          image: user.image,
          roleId: parsed.data.roleId ?? null,
        },
        organizationId,
      },
    });

    return user;
  });

  const roles = await prisma.userRole.findMany({
    where: { userId: id, organizationId },
    include: { role: { select: { name: true } } },
  });

  return serialize(
    updated as UserRecord,
    (roles as Array<{ role: { name: string } }>).map((r) => r.role.name)
  );
}

/**
 * Remove a member from the organization.
 *
 * The user row survives (it is their login); the membership and the
 * organization link are cleared, the status becomes `suspended`, and every live
 * session is revoked. The last active administrator cannot be removed, and
 * nobody can remove themselves.
 */
export async function removeMember(id: string) {
  const { userId: actorId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(actorId, organizationId, 'user.delete');

  if (id === actorId) throw codedError('You cannot remove yourself', 400);

  await prisma.$transaction(async (tx: typeof prisma) => {
    await tx.$queryRawUnsafe(
      'SELECT id FROM "Organization" WHERE id = $1 FOR UPDATE',
      organizationId
    );
    const existing = await tx.user.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true },
    });
    if (!existing) throw codedError('Not found', 404);

    const isAdmin = await tx.userRole.findFirst({
      where: { userId: id, organizationId, role: { isSystem: true, name: 'Administrator' } },
      select: { id: true },
    });
    if (isAdmin && (await activeAdministratorCount(organizationId, id, tx)) === 0) {
      throw codedError('The organization must keep at least one active administrator', 400);
    }

    // Revoke live sessions before detaching the membership: the removed member
    // must not keep acting on a cookie issued while they were still a member.
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.userRole.deleteMany({ where: { userId: id, organizationId } });
    await tx.user.update({
      where: { id },
      data: { organizationId: null, status: 'suspended' },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        actorName: actorEmail,
        action: 'user.remove',
        entityType: 'User',
        entityId: id,
        before: { organizationId, status: existing.status },
        after: { organizationId: null, status: 'suspended' },
        organizationId,
      },
    });
  });

  return { id };
}
