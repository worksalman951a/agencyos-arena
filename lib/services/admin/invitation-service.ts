'use server';

/**
 * Organization membership invitations.
 *
 * Security properties:
 * - Only the invitation e-mail receives the raw token. Only its SHA-256 hash
 *   is stored, and API responses never include the token, so neither database
 *   dumps nor administrator API access can replay it.
 * - Tokens expire (7 days by default) and are single-use: acceptance flips the
 *   row to `accepted` inside the same transaction that creates the membership,
 *   and a second attempt gets 410 Gone.
 * - Acceptance is bound to the invited e-mail address. A leaked link cannot be
 *   redeemed by a different account.
 * - Every mutation is scoped to the administrator's organization and audited.
 *
 * Team invitations use the shared SMTP delivery pipeline. Resending rotates
 * the credential and revokes the prior token; plaintext is never recoverable.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { prisma } from '@/lib/db';
import {
  getUserPermissions,
  requirePermission,
  requireOrganization,
  type AuthorizedUser,
} from '@/lib/permissions';
import { sendTeamInvitationEmail } from '@/lib/email/invitation-emails';
import {
  deliveryAuditRecord,
  summarizeDelivery,
  type EmailDeliveryResult,
} from '@/lib/email/types';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { INVITATION_TTL_DAYS, invitationCreateSchema } from '@/lib/schemas/admin/invitation.schema';

export interface InvitationResponse {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  roleName: string;
  status: string;
  expiresAt: Date;
  invitedBy: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
}

function codedError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
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
    email: (result.user.email ?? '').toLowerCase(),
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
      entityType: 'Invitation',
      entityId,
      before: before ?? null,
      after: after ?? null,
      organizationId,
    },
  });
}

export async function listInvitations() {
  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'invitation.read');

  const invitations = await prisma.invitation.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { role: { select: { name: true } } },
  });

  return (
    invitations as Array<{
      id: string;
      organizationId: string;
      email: string;
      roleId: string;
      status: string;
      expiresAt: Date;
      invitedBy: string | null;
      acceptedAt: Date | null;
      createdAt: Date;
      role: { name: string };
    }>
  ).map((invitation) => ({
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    roleId: invitation.roleId,
    roleName: invitation.role.name,
    status:
      invitation.status === 'pending' && invitation.expiresAt <= new Date()
        ? 'expired'
        : invitation.status,
    expiresAt: invitation.expiresAt,
    invitedBy: invitation.invitedBy,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
  })) satisfies InvitationResponse[];
}

/** Ensure the selected organization role cannot grant permissions the actor lacks. */
async function assertRoleAssignable(roleId: string, organizationId: string, actorId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId },
    include: { permissions: { include: { permission: { select: { code: true } } } } },
  });
  if (!role) throw codedError('Role not found in this organization', 404);

  const held = await getUserPermissions(actorId, organizationId);
  if (
    role.permissions.some(
      (entry: { permission: { code: string } }) => !held.has(entry.permission.code)
    )
  ) {
    throw codedError('You cannot assign a role with permissions you do not hold', 403);
  }
  return role;
}

const PENDING_INVITATION_INDEX = 'Invitation_pending_org_email_key';

function isPendingInvitationConflict(error: unknown): boolean {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const item = current as {
      code?: unknown;
      message?: unknown;
      meta?: { target?: unknown };
      cause?: unknown;
    };
    if (typeof item.code === 'string') parts.push(item.code);
    if (typeof item.message === 'string') parts.push(item.message);
    if (typeof item.meta?.target === 'string') parts.push(item.meta.target);
    if (Array.isArray(item.meta?.target)) parts.push(item.meta.target.join(','));
    current = item.cause;
  }
  const text = parts.join(' ');
  return (
    (/P2002|23505/.test(text) || /unique constraint/i.test(text)) &&
    (text.includes(PENDING_INVITATION_INDEX) ||
      (text.includes('organizationId') && text.toLowerCase().includes('email')))
  );
}

async function sendInvitationEmail(input: {
  organizationId: string;
  organizationName: string;
  email: string;
  invitationId: string;
  token: string;
  expiresAt: Date;
  actorId: string;
  actorEmail: string;
}) {
  let delivery: EmailDeliveryResult;
  try {
    delivery = await sendTeamInvitationEmail({
      organizationId: input.organizationId,
      organizationName: input.organizationName,
      to: input.email,
      acceptPath: `/invite/${input.token}`,
      expiresAt: input.expiresAt,
    });
  } catch (error) {
    console.error('[email] the team invitation e-mail could not be handed over', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    delivery = { status: 'failed', reason: 'unknown', attempts: 0 };
  }

  const record = deliveryAuditRecord(delivery);
  if (record) {
    try {
      await audit({
        actorId: input.actorId,
        actorName: input.actorEmail,
        action: `invitation.${record.event}`,
        entityId: input.invitationId,
        after: record.details,
        organizationId: input.organizationId,
      });
    } catch {
      console.error('[email] could not record the team-invitation delivery outcome', {
        entityType: 'Invitation',
        entityId: input.invitationId,
        event: record.event,
      });
    }
  }
  return summarizeDelivery(delivery);
}

/** Create an invitation and e-mail its one-time link; the token is never returned by the API. */
export async function createInvitation(input: unknown) {
  const parsed = invitationCreateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'invitation.create');
  const role = await assertRoleAssignable(parsed.data.roleId, organizationId, userId);

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  let created: {
    id: string;
    email: string;
    roleId: string;
    status: string;
    expiresAt: Date;
    organizationName: string;
  };
  try {
    created = await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.$queryRawUnsafe(
        'SELECT id FROM "Organization" WHERE id = $1 FOR UPDATE',
        organizationId
      );
      const existingMember = await tx.user.findFirst({
        where: { email: { equals: parsed.data.email, mode: 'insensitive' }, organizationId },
        select: { id: true },
      });
      if (existingMember) throw codedError('This person is already a member', 409);

      await tx.invitation.updateMany({
        where: {
          organizationId,
          email: { equals: parsed.data.email, mode: 'insensitive' },
          status: 'pending',
          expiresAt: { lte: now },
        },
        data: { status: 'expired' },
      });
      const live = await tx.invitation.findFirst({
        where: {
          organizationId,
          email: { equals: parsed.data.email, mode: 'insensitive' },
          status: 'pending',
        },
        select: { id: true },
      });
      if (live) throw codedError('A pending invitation already exists for this address', 409);

      const invitation = await tx.invitation.create({
        data: {
          organizationId,
          email: parsed.data.email,
          roleId: role.id,
          tokenHash,
          status: 'pending',
          expiresAt,
          invitedBy: userId,
        },
      });
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorName: actorEmail,
          action: 'invitation.create',
          entityType: 'Invitation',
          entityId: invitation.id,
          before: null,
          after: { email: invitation.email, roleId: invitation.roleId, expiresAt },
          organizationId,
        },
      });
      return { ...invitation, organizationName: organization.name };
    });
  } catch (error) {
    if (isPendingInvitationConflict(error)) {
      throw codedError('A pending invitation already exists for this address', 409);
    }
    throw error;
  }

  const emailDelivery = await sendInvitationEmail({
    organizationId,
    organizationName: created.organizationName,
    email: created.email,
    invitationId: created.id,
    token,
    expiresAt: created.expiresAt,
    actorId: userId,
    actorEmail,
  });
  return {
    id: created.id,
    email: created.email,
    roleId: created.roleId,
    roleName: role.name,
    status: created.status,
    expiresAt: created.expiresAt,
    emailDelivery,
  };
}

/** Rotate a pending invitation's credential and send only the new one. */
export async function resendInvitation(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'invitation.create');
  await requirePermission(userId, organizationId, 'invitation.revoke');

  const oldTokenless = await prisma.invitation.findFirst({
    where: { id, organizationId },
    include: { role: { select: { id: true, name: true } } },
  });
  if (!oldTokenless) throw codedError('Not found', 404);
  if (oldTokenless.status !== 'pending')
    throw codedError('Only pending invitations can be resent', 400);
  const role = await assertRoleAssignable(oldTokenless.roleId, organizationId, userId);

  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const created = await prisma.$transaction(async (tx: typeof prisma) => {
    await tx.$queryRawUnsafe(
      'SELECT id FROM "Organization" WHERE id = $1 FOR UPDATE',
      organizationId
    );
    const revoked = await tx.invitation.updateMany({
      where: { id, organizationId, status: 'pending' },
      data: { status: 'revoked', revokedAt: now },
    });
    if (revoked.count !== 1) throw codedError('Only pending invitations can be resent', 409);
    const replacement = await tx.invitation.create({
      data: {
        organizationId,
        email: oldTokenless.email,
        roleId: oldTokenless.roleId,
        tokenHash: hashToken(token),
        status: 'pending',
        expiresAt,
        invitedBy: userId,
      },
    });
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorName: actorEmail,
        action: 'invitation.resend',
        entityType: 'Invitation',
        entityId: replacement.id,
        before: { previousInvitationId: id, status: 'pending' },
        after: { email: replacement.email, roleId: replacement.roleId, expiresAt },
        organizationId,
      },
    });
    return { ...replacement, organizationName: organization.name };
  });

  const emailDelivery = await sendInvitationEmail({
    organizationId,
    organizationName: created.organizationName,
    email: created.email,
    invitationId: created.id,
    token,
    expiresAt: created.expiresAt,
    actorId: userId,
    actorEmail,
  });
  return {
    id: created.id,
    email: created.email,
    roleId: created.roleId,
    roleName: role.name,
    status: created.status,
    expiresAt: created.expiresAt,
    emailDelivery,
  };
}

export async function revokeInvitation(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'invitation.revoke');

  const invitation = await prisma.invitation.findFirst({ where: { id, organizationId } });
  if (!invitation) throw codedError('Not found', 404);
  if (invitation.status !== 'pending') {
    throw codedError('Only pending invitations can be revoked', 400);
  }

  const revoked = await prisma.$transaction(async (tx: typeof prisma) => {
    const update = await tx.invitation.updateMany({
      where: { id, organizationId, status: 'pending' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    if (update.count !== 1) throw codedError('Only pending invitations can be revoked', 409);
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorName: actorEmail,
        action: 'invitation.revoke',
        entityType: 'Invitation',
        entityId: id,
        before: { status: invitation.status },
        after: { status: 'revoked' },
        organizationId,
      },
    });
    return { id, status: 'revoked' };
  });

  return revoked;
}

/** Public view of an invitation, resolved from its raw bearer token. */
export async function getInvitationByToken(token: string) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw codedError('Invitation not found', 404);
  }
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      organization: { select: { id: true, name: true } },
      role: { select: { name: true } },
    },
  });

  if (!invitation) throw codedError('Invitation not found', 404);
  if (invitation.status !== 'pending') {
    throw codedError(`Invitation has been ${invitation.status}`, 410);
  }
  if (invitation.expiresAt <= new Date()) {
    await prisma.invitation.updateMany({
      where: { id: invitation.id, status: 'pending' },
      data: { status: 'expired' },
    });
    throw codedError('Invitation has expired', 410);
  }

  return {
    id: invitation.id,
    email: invitation.email,
    organizationName: invitation.organization.name,
    roleName: invitation.role.name,
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Accept a pending invitation as the verified, signed-in user whose e-mail
 * matches it. The token alone never creates an account or grants membership.
 */
export async function acceptInvitation(token: string) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw codedError('Invitation not found', 404);
  }
  const cookieStore = await cookies();
  const session = await auth.api.getSession({ headers: { cookie: cookieStore.toString() } });
  if (!session?.session || !session.user) throw codedError('Unauthenticated', 401);

  const sessionUserId = session.user.id;
  const sessionEmail = (session.user.email ?? '').toLowerCase();
  const now = new Date();

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invitation) throw codedError('Invitation not found', 404);
  if (invitation.status !== 'pending') {
    throw codedError(`Invitation has been ${invitation.status}`, 410);
  }
  if (invitation.expiresAt <= now) throw codedError('Invitation has expired', 410);
  if (!tokensMatch(invitation.email.toLowerCase(), sessionEmail)) {
    throw codedError('This invitation was issued to a different e-mail address', 403);
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: {
      id: true,
      organizationId: true,
      userType: true,
      status: true,
      emailVerified: true,
    },
  });
  if (!user || user.status !== 'active' || user.userType !== 'internal') {
    throw codedError('This account is not eligible to accept a team invitation', 403);
  }
  if (!user.emailVerified) {
    throw codedError(
      'Verify ownership of this e-mail address before accepting the invitation',
      403
    );
  }
  if (
    user.organizationId ||
    (await prisma.userRole.count({ where: { userId: sessionUserId } })) > 0
  ) {
    throw codedError('You already belong to a workspace', 409);
  }

  return prisma.$transaction(async (tx: typeof prisma) => {
    // The compare-and-set claim and conditional membership update make replay
    // and concurrent acceptance across organizations single-winner operations.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'pending', expiresAt: { gt: now } },
      data: { status: 'accepted', acceptedAt: now, acceptedBy: sessionUserId },
    });
    if (claimed.count !== 1) throw codedError('Invitation is no longer available', 410);

    const joined = await tx.user.updateMany({
      where: {
        id: sessionUserId,
        organizationId: null,
        status: 'active',
        userType: 'internal',
        emailVerified: true,
      },
      data: { organizationId: invitation.organizationId },
    });
    if (joined.count !== 1) throw codedError('This account already belongs to a workspace', 409);

    await tx.userRole.create({
      data: {
        userId: sessionUserId,
        roleId: invitation.roleId,
        organizationId: invitation.organizationId,
        assignedBy: invitation.invitedBy ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: sessionUserId,
        actorName: sessionEmail,
        action: 'invitation.accept',
        entityType: 'Invitation',
        entityId: invitation.id,
        before: { status: 'pending' },
        after: { status: 'accepted' },
        organizationId: invitation.organizationId,
      },
    });
    return { organizationId: invitation.organizationId };
  });
}
