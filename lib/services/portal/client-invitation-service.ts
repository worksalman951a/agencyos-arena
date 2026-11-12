'use server';

/**
 * Client-portal invitations.
 *
 * Security properties (mirrors `invitation-service` for team invitations, but
 * never grants organization membership or a role):
 * - Only the SHA-256 hash of the token is stored; the raw token is returned once
 *   to the administrator who created it.
 * - Tokens expire (7 days), are single-use and can be revoked. Acceptance flips
 *   the row inside the same transaction that creates the portal identity, so a
 *   replayed link gets 410 Gone.
 * - Acceptance is bound to the invited e-mail address; a leaked link alone cannot
 *   become a portal login.
 * - A user who already belongs to an organization - or who is already a portal
 *   client - cannot be converted into a client of this organization.
 * - The identity created is `userType = "client"` with no `organizationId` and no
 *   `UserRole` rows: internal RBAC can never resolve permissions for it.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';

import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { CLIENT_ROLE_PRESETS } from '@/lib/portal/capabilities';
import { codedError } from '@/lib/portal/access-control';
import { writePortalAudit } from '@/lib/portal/audit';
import { notifyUser } from '@/lib/portal/notify';
import { requireInternalActor } from '@/lib/portal/internal-actor';
import {
  CLIENT_INVITATION_TTL_DAYS,
  clientInvitationCreateSchema,
} from '@/lib/schemas/portal/client-portal.schema';

interface ClientInvitationRow {
  id: string;
  organizationId: string;
  email: string;
  contactId: string;
  status: string;
  role: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  contact: { firstName: string | null; lastName: string };
}

export interface ClientInvitationResponse {
  id: string;
  organizationId: string;
  email: string;
  contactId: string;
  contactName: string;
  status: string;
  role: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function emailsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a.trim().toLowerCase(), 'utf8');
  const right = Buffer.from(b.trim().toLowerCase(), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function contactName(contact: { firstName: string | null; lastName: string }): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
}

/** List invitations for the caller's organization. */
export async function listClientInvitations(): Promise<ClientInvitationResponse[]> {
  const actor = await requireInternalActor('client.invitation.read');

  const invitations = (await prisma.clientInvitation.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { contact: { select: { firstName: true, lastName: true } } },
  })) as ClientInvitationRow[];

  return invitations.map((invitation) => ({
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    contactId: invitation.contactId,
    contactName: contactName(invitation.contact),
    status:
      invitation.status === 'pending' && invitation.expiresAt <= new Date()
        ? 'expired'
        : invitation.status,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  }));
}

/**
 * Invite a CRM contact into the portal. The raw token is returned exactly once.
 */
export async function createClientInvitation(input: unknown) {
  const parsed = clientInvitationCreateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const actor = await requireInternalActor('client.invitation.create');
  const { email, contactId, role } = parsed.data;

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: actor.organizationId, deletedAt: null },
    select: { id: true, email: true, firstName: true, lastName: true, accountId: true },
  });
  if (!contact) throw codedError('Contact not found', 404);
  if (contact.email && !emailsMatch(contact.email, email)) {
    throw codedError('The invitation e-mail must match the contact e-mail', 400);
  }

  // Already an active portal client in this organization?
  const existingAccess = await prisma.clientAccess.findFirst({
    where: { organizationId: actor.organizationId, contactId: contact.id },
    select: { id: true, status: true },
  });
  if (existingAccess && existingAccess.status === 'active') {
    throw codedError('This contact already has portal access', 409);
  }

  // One live invitation per (org, e-mail): revoke the outstanding one first.
  const live = await prisma.clientInvitation.findFirst({
    where: { organizationId: actor.organizationId, email, status: 'pending' },
    select: { id: true, expiresAt: true },
  });
  if (live && live.expiresAt > new Date()) {
    throw codedError('A pending invitation already exists for this address', 409);
  }

  const preset = CLIENT_ROLE_PRESETS[role];
  const flags = {
    canViewInvoices: parsed.data.canViewInvoices ?? preset.flags.canViewInvoices,
    canDownloadFiles: parsed.data.canDownloadFiles ?? preset.flags.canDownloadFiles,
    canComment: parsed.data.canComment ?? preset.flags.canComment,
    canApprove: parsed.data.canApprove ?? preset.flags.canApprove,
  };

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CLIENT_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await prisma.clientInvitation.create({
    data: {
      organizationId: actor.organizationId,
      email,
      contactId: contact.id,
      accountId: contact.accountId ?? null,
      tokenHash: hashToken(token),
      status: 'pending',
      role,
      ...flags,
      expiresAt,
      invitedBy: actor.userId,
    },
  });

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: 'client.invitation.create',
    entityType: 'ClientInvitation',
    entityId: invitation.id,
    after: { email, contactId: contact.id, role, expiresAt, ...flags },
  });

  return {
    id: invitation.id,
    email: invitation.email,
    contactId: invitation.contactId,
    contactName: contactName(contact),
    status: invitation.status,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    // Shown once, never stored in plaintext.
    token,
    acceptPath: `/portal/invite/${token}`,
  };
}

/** Revoke a pending invitation. */
export async function revokeClientInvitation(id: string) {
  const actor = await requireInternalActor('client.invitation.revoke');

  const invitation = await prisma.clientInvitation.findFirst({
    where: { id, organizationId: actor.organizationId },
  });
  if (!invitation) throw codedError('Not found', 404);
  if (invitation.status !== 'pending') {
    throw codedError('Only pending invitations can be revoked', 400);
  }

  const now = new Date();
  const revoked = await prisma.clientInvitation.update({
    where: { id: invitation.id },
    data: { status: 'revoked', revokedAt: now },
  });

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: 'client.invitation.revoke',
    entityType: 'ClientInvitation',
    entityId: revoked.id,
    before: { status: 'pending' },
    after: { status: 'revoked' },
  });

  return { id: revoked.id, status: revoked.status };
}

export interface PublicClientInvitation {
  id: string;
  email: string;
  organizationName: string;
  contactName: string;
  expiresAt: Date;
  capabilities: string[];
}

/**
 * Resolve an invitation from its raw token, for the acceptance page.
 *
 * Public by design (the token is the credential) and discloses only what the
 * invitee needs to recognise the invitation: organization name, contact name and
 * their own e-mail address.
 */
export async function getClientInvitationByToken(token: string): Promise<PublicClientInvitation> {
  if (!token || token.length < 20) throw codedError('Invitation not found', 404);

  const invitation = await prisma.clientInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      organization: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true } },
    },
  });

  if (!invitation) throw codedError('Invitation not found', 404);

  if (invitation.status === 'pending' && invitation.expiresAt <= new Date()) {
    // Lazily record expiry so the administrator sees it in the list.
    await prisma.clientInvitation.updateMany({
      where: { id: invitation.id, status: 'pending' },
      data: { status: 'expired' },
    });
    throw codedError('Invitation has expired', 410);
  }
  if (invitation.status !== 'pending') {
    throw codedError(`Invitation has been ${invitation.status}`, 410);
  }

  const capabilities: string[] = [];
  if (invitation.canViewInvoices) capabilities.push('view invoices');
  if (invitation.canDownloadFiles) capabilities.push('download files');
  if (invitation.canComment) capabilities.push('comment');
  if (invitation.canApprove) capabilities.push('approve work');

  return {
    id: invitation.id,
    email: invitation.email,
    organizationName: invitation.organization.name,
    contactName: contactName(invitation.contact),
    expiresAt: invitation.expiresAt,
    capabilities,
  };
}

/**
 * Accept an invitation as the signed-in user.
 *
 * The session e-mail must match the invitation: possessing the link is not
 * enough. Acceptance is atomic, so a double click (or a replayed request) can
 * only ever create one portal identity.
 */
export async function acceptClientInvitation(token: string) {
  if (!token || token.length < 20) throw codedError('Invitation not found', 404);

  const cookieStore = await cookies();
  const session = await auth.api.getSession({ headers: { cookie: cookieStore.toString() } });
  if (!session?.session || !session.user) throw codedError('Unauthenticated', 401);

  const sessionUserId = session.user.id;
  const sessionEmail = (session.user.email ?? '').toLowerCase();

  const invitation = await prisma.clientInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invitation) throw codedError('Invitation not found', 404);
  if (invitation.status !== 'pending') {
    throw codedError(`Invitation has been ${invitation.status}`, 410);
  }
  if (invitation.expiresAt <= new Date()) throw codedError('Invitation has expired', 410);

  if (!emailsMatch(invitation.email, sessionEmail)) {
    throw codedError('This invitation was issued to a different e-mail address', 403);
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: { id: true, organizationId: true, userType: true, status: true },
  });
  if (!user) throw codedError('Unauthenticated', 401);
  if (user.status !== 'active') throw codedError('This account is disabled', 403);

  // Never convert a team member (or an existing client elsewhere) into a client
  // here: that would silently change what an existing session can do.
  if (user.userType === 'client' || user.organizationId) {
    throw codedError('This account already belongs to a workspace', 409);
  }

  const existingRoles = await prisma.userRole.count({ where: { userId: sessionUserId } });
  if (existingRoles > 0) {
    throw codedError('This account already belongs to a workspace', 409);
  }

  const now = new Date();

  const access = await prisma.$transaction(async (tx: typeof prisma) => {
    // Claim the invitation: only a still-pending row may be consumed, so two
    // concurrent acceptances cannot both succeed.
    const claimed = await tx.clientInvitation.updateMany({
      where: { id: invitation.id, status: 'pending', expiresAt: { gt: now } },
      data: { status: 'accepted', acceptedAt: now, acceptedByUserId: sessionUserId },
    });
    if (claimed.count !== 1) {
      throw codedError('Invitation has already been accepted', 410);
    }

    // The user may already have a portal identity from a previous invitation.
    const alreadyLinked = await tx.clientAccess.findUnique({
      where: { userId: sessionUserId },
      select: { id: true },
    });
    if (alreadyLinked) {
      throw codedError('This account is already linked to a client portal', 409);
    }

    const created = await tx.clientAccess.create({
      data: {
        organizationId: invitation.organizationId,
        userId: sessionUserId,
        contactId: invitation.contactId,
        accountId: invitation.accountId,
        status: 'active',
        role: invitation.role,
        canViewInvoices: invitation.canViewInvoices,
        canDownloadFiles: invitation.canDownloadFiles,
        canComment: invitation.canComment,
        canApprove: invitation.canApprove,
        invitedBy: invitation.invitedBy,
      },
    });

    // Mark the identity as a client and keep it out of every organization.
    await tx.user.update({
      where: { id: sessionUserId },
      data: { userType: 'client', organizationId: null, status: 'active' },
    });

    return created;
  });

  await writePortalAudit({
    organizationId: invitation.organizationId,
    actorId: sessionUserId,
    actorName: sessionEmail,
    action: 'client.invitation.accept',
    entityType: 'ClientInvitation',
    entityId: invitation.id,
    before: { status: 'pending' },
    after: { status: 'accepted', clientAccessId: access.id },
    metadata: { actorType: 'client' },
  });

  await notifyUser({
    organizationId: invitation.organizationId,
    userId: sessionUserId,
    type: 'client.access.activated',
    payload: { clientAccessId: access.id, message: 'Your client portal access is active.' },
    dedupeKey: `client-access-activated:${access.id}`,
  });

  if (invitation.invitedBy) {
    await notifyUser({
      organizationId: invitation.organizationId,
      userId: invitation.invitedBy,
      type: 'client.invitation.accepted',
      payload: {
        clientAccessId: access.id,
        email: invitation.email,
        message: 'A client accepted their portal invitation.',
      },
      dedupeKey: `client-invitation-accepted:${invitation.id}`,
    });
  }

  return { clientAccessId: access.id, organizationId: access.organizationId };
}
