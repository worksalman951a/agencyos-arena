'use server';

/**
 * Organization membership invitations.
 *
 * Security properties:
 * - The raw token is returned exactly once, to the administrator who created
 *   it. Only its SHA-256 hash is stored, so a database dump cannot be replayed
 *   into a workspace.
 * - Tokens expire (7 days by default) and are single-use: acceptance flips the
 *   row to `accepted` inside the same transaction that creates the membership,
 *   and a second attempt gets 410 Gone.
 * - Acceptance is bound to the invited e-mail address. A leaked link cannot be
 *   redeemed by a different account.
 * - Every mutation is scoped to the administrator's organization and audited.
 *
 * Not implemented here: outbound e-mail. The API returns the acceptance link so
 * an administrator can deliver it out-of-band. The mailer added in Phase 4D /
 * Batch 4A (lib/email, docs/phase-4d/email-delivery.md) is wired to client-portal
 * invitations only; team invitations are unchanged.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
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
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    invitedBy: invitation.invitedBy,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
  })) satisfies InvitationResponse[];
}

/**
 * Create an invitation. The caller receives the raw token once; it is never
 * retrievable again.
 */
export async function createInvitation(input: unknown) {
  const parsed = invitationCreateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'invitation.create');

  const role = await prisma.role.findFirst({
    where: { id: parsed.data.roleId, organizationId },
    select: { id: true, name: true },
  });
  if (!role) throw codedError('Role not found in this organization', 404);

  // Already a member? Inviting an existing member silently does nothing.
  const existingMember = await prisma.user.findFirst({
    where: { email: parsed.data.email, organizationId },
    select: { id: true },
  });
  if (existingMember) throw codedError('This person is already a member', 400);

  // One live invitation per (org, email): re-inviting replaces nothing, it
  // tells the administrator to revoke the outstanding one first.
  const live = await prisma.invitation.findFirst({
    where: { organizationId, email: parsed.data.email, status: 'pending' },
    select: { id: true, expiresAt: true },
  });
  if (live && live.expiresAt > new Date()) {
    throw codedError('A pending invitation already exists for this address', 400);
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: {
      organizationId,
      email: parsed.data.email,
      roleId: role.id,
      tokenHash: hashToken(token),
      status: 'pending',
      expiresAt,
      invitedBy: userId,
    },
  });

  await audit({
    actorId: userId,
    actorName: actorEmail,
    action: 'invitation.create',
    entityId: invitation.id,
    after: { email: invitation.email, roleId: invitation.roleId, expiresAt },
    organizationId,
  });

  return {
    id: invitation.id,
    email: invitation.email,
    roleId: invitation.roleId,
    roleName: role.name,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    // Shown once, never stored in plaintext.
    token,
    acceptPath: `/invite/${token}`,
  };
}

export async function revokeInvitation(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'invitation.revoke');

  const invitation = await prisma.invitation.findFirst({
    where: { id, organizationId },
  });
  if (!invitation) throw codedError('Not found', 404);
  if (invitation.status !== 'pending') {
    throw codedError('Only pending invitations can be revoked', 400);
  }

  const revoked = await prisma.invitation.update({
    where: { id },
    data: { status: 'revoked', revokedAt: new Date() },
  });

  await audit({
    actorId: userId,
    actorName: actorEmail,
    action: 'invitation.revoke',
    entityId: id,
    before: { status: invitation.status },
    after: { status: revoked.status },
    organizationId,
  });

  return { id: revoked.id, status: revoked.status };
}

/** Public view of an invitation, resolved from the raw token. */
export async function getInvitationByToken(token: string) {
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
 * Accept an invitation as the signed-in user.
 *
 * Rejects when the session e-mail does not match the invitation: the token
 * alone must never be enough to join an organization.
 */
export async function acceptInvitation(token: string) {
  const cookieStore = await cookies();
  const session = await auth.api.getSession({ headers: { cookie: cookieStore.toString() } });
  if (!session?.session || !session.user) throw codedError('Unauthenticated', 401);

  const sessionUserId = session.user.id;
  const sessionEmail = (session.user.email ?? '').toLowerCase();

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invitation) throw codedError('Invitation not found', 404);
  if (invitation.status !== 'pending')
    throw codedError(`Invitation has been ${invitation.status}`, 410);
  if (invitation.expiresAt <= new Date()) throw codedError('Invitation has expired', 410);

  if (!tokensMatch(invitation.email.toLowerCase(), sessionEmail)) {
    throw codedError('This invitation was issued to a different e-mail address', 403);
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: { id: true, organizationId: true },
  });
  if (!user) throw codedError('Unauthenticated', 401);
  if (user.organizationId) {
    throw codedError('You already belong to an organization', 409);
  }

  const result = await prisma.$transaction(async (tx: typeof prisma) => {
    // Guard against a double-accept race: only an invitation still `pending`
    // can be claimed.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'pending' },
      data: { status: 'accepted', acceptedAt: new Date(), acceptedBy: sessionUserId },
    });
    if (claimed.count !== 1) {
      throw codedError('Invitation has already been accepted', 410);
    }

    await tx.user.update({
      where: { id: sessionUserId },
      data: { organizationId: invitation.organizationId },
    });

    await tx.userRole.create({
      data: {
        userId: sessionUserId,
        roleId: invitation.roleId,
        organizationId: invitation.organizationId,
        assignedBy: invitation.invitedBy ?? null,
      },
    });

    return { organizationId: invitation.organizationId };
  });

  await prisma.auditLog.create({
    data: {
      actorId: sessionUserId,
      actorName: sessionEmail,
      action: 'invitation.accept',
      entityType: 'Invitation',
      entityId: invitation.id,
      before: { status: 'pending' },
      after: { status: 'accepted' },
      organizationId: result.organizationId,
    },
  });

  return { organizationId: result.organizationId };
}
