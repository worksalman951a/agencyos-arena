'use server';

/**
 * Administration: roles and permissions.
 *
 * Defects this replaces:
 * - `updateRole` let any caller with `role.update` grant **any** permission
 *   code, including `role.update` and `user.update` they may not hold
 *   themselves — a straightforward privilege-escalation path. A caller can now
 *   only grant codes they already hold.
 * - Permissions were created on the fly from user input (an arbitrary-string
 *   store). Only codes that exist in the catalogue are accepted now.
 * - No audit entry was written for a permission change.
 * - System roles were rejected with 400 but custom roles could be renamed to
 *   "Administrator", confusing every role-name lookup; that is now rejected.
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
import { roleCreateSchema, roleUpdateSchema } from '@/lib/schemas/admin/member.schema';

export interface RoleResponse {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{ id: string; code: string; description: string | null }>;
}

function codedError(message: string, statusCode: number, issues?: unknown[]) {
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

async function audit({
  actorId,
  actorName,
  action,
  entityId,
  before,
  after,
  organizationId,
}: {
  actorId: string;
  actorName: string | null;
  action: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  organizationId: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorId,
      actorName,
      action,
      entityType: 'Role',
      entityId,
      before: before ?? null,
      after: after ?? null,
      organizationId,
    },
  });
}

interface RoleRecord {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{ permission: { id: string; code: string; description: string | null } }>;
}

function serializeRole(role: RoleRecord): RoleResponse {
  return {
    id: role.id,
    organizationId: role.organizationId,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    permissions: role.permissions.map((rp) => ({
      id: rp.permission.id,
      code: rp.permission.code,
      description: rp.permission.description,
    })),
  };
}

/**
 * Reject any code the actor does not hold.
 *
 * Granting a permission you do not have is privilege escalation even when the
 * actor legitimately holds `role.update`.
 */
async function assertCanGrant(
  actorId: string,
  organizationId: string,
  codes: string[]
): Promise<void> {
  const actorPermissions = await getUserPermissions(actorId, organizationId);
  const escalated = codes.filter((code) => !actorPermissions.has(code));
  if (escalated.length > 0) {
    throw codedError(`You cannot grant permissions you do not hold: ${escalated.join(', ')}`, 403);
  }
}

async function permissionIdsFor(codes: string[]) {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const known = new Set((permissions as Array<{ code: string }>).map((p) => p.code));
  const unknown = codes.filter((code) => !known.has(code));
  if (unknown.length > 0) {
    throw codedError(`Unknown permission code: ${unknown.join(', ')}`, 400);
  }
  return permissions as Array<{ id: string; code: string }>;
}

export async function listRoles() {
  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'role.read');

  const roles = await prisma.role.findMany({
    where: { organizationId },
    include: { permissions: { include: { permission: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (roles as RoleRecord[]).map(serializeRole);
}

export async function getRole(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'role.read');

  const role = await prisma.role.findFirst({
    where: { id, organizationId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) throw codedError('Not found', 404);

  return serializeRole(role as RoleRecord);
}

export async function createRole(input: unknown) {
  const parsed = roleCreateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400, parsed.error.issues);

  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'role.update');

  const duplicate = await prisma.role.findFirst({
    where: { organizationId, name: parsed.data.name },
    select: { id: true },
  });
  if (duplicate) throw codedError('A role with this name already exists', 400);

  const codes = parsed.data.permissionCodes ?? [];
  // Existence first: an unknown code is a bad request (400), while a real code
  // the actor does not hold is privilege escalation (403).
  const permissions = codes.length > 0 ? await permissionIdsFor(codes) : [];
  await assertCanGrant(userId, organizationId, codes);

  const role = await prisma.role.create({
    data: {
      organizationId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isSystem: false,
      permissions: {
        create: permissions.map((permission) => ({ permissionId: permission.id })),
      },
    },
    include: { permissions: { include: { permission: true } } },
  });

  await audit({
    actorId: userId,
    actorName: actorEmail,
    action: 'role.create',
    entityId: role.id,
    after: { name: role.name, permissions: codes },
    organizationId,
  });

  return serializeRole(role as RoleRecord);
}

export async function updateRole(id: string, input: unknown) {
  const parsed = roleUpdateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400, parsed.error.issues);

  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'role.update');

  const existing = await prisma.role.findFirst({
    where: { id, organizationId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!existing) throw codedError('Not found', 404);
  if (existing.isSystem) throw codedError('Cannot modify system roles', 400);

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const duplicate = await prisma.role.findFirst({
      where: { organizationId, name: parsed.data.name, NOT: { id } },
      select: { id: true },
    });
    if (duplicate) throw codedError('A role with this name already exists', 400);
  }

  const beforeCodes = (existing as RoleRecord).permissions.map((rp) => rp.permission.code);

  const permissions =
    parsed.data.permissionCodes !== undefined
      ? await permissionIdsFor(parsed.data.permissionCodes)
      : [];

  if (parsed.data.permissionCodes !== undefined) {
    await assertCanGrant(userId, organizationId, parsed.data.permissionCodes);
    // Removing a permission you do not hold is also a privileged change.
    await assertCanGrant(
      userId,
      organizationId,
      beforeCodes.filter((code) => !parsed.data.permissionCodes!.includes(code))
    );
  }

  const role = await prisma.$transaction(async (tx: typeof prisma) => {
    const updated = await tx.role.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      },
    });

    if (parsed.data.permissionCodes !== undefined) {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: id, permissionId: permission.id })),
        });
      }
    }

    return updated;
  });

  const withPermissions = await prisma.role.findFirstOrThrow({
    where: { id: role.id },
    include: { permissions: { include: { permission: true } } },
  });

  await audit({
    actorId: userId,
    actorName: actorEmail,
    action: 'role.update',
    entityId: id,
    before: { name: existing.name, permissions: beforeCodes },
    after: { name: role.name, permissions: parsed.data.permissionCodes ?? beforeCodes },
    organizationId,
  });

  return serializeRole(withPermissions as RoleRecord);
}

/** Delete a custom role. Roles still assigned to members are refused. */
export async function deleteRole(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'role.delete');

  const existing = await prisma.role.findFirst({ where: { id, organizationId } });
  if (!existing) throw codedError('Not found', 404);
  if (existing.isSystem) throw codedError('Cannot delete system roles', 400);

  const assigned = await prisma.userRole.count({ where: { roleId: id, organizationId } });
  if (assigned > 0) {
    throw codedError('Reassign the members who hold this role before deleting it', 400);
  }

  await prisma.role.delete({ where: { id } });

  await audit({
    actorId: userId,
    actorName: actorEmail,
    action: 'role.delete',
    entityId: id,
    before: { name: existing.name },
    organizationId,
  });

  return { id };
}

interface PermissionRecord {
  id: string;
  code: string;
  description: string | null;
}

export async function listPermissions() {
  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'role.read');

  const permissions = await prisma.permission.findMany({ orderBy: { code: 'asc' } });

  return (permissions as PermissionRecord[]).map((permission) => ({
    id: permission.id,
    code: permission.code,
    description: permission.description,
  }));
}
