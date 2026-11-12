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
 *
 * E-mail delivery (Phase 4D / Batch 4A, docs/phase-4d/email-delivery.md):
 * - Creating an invitation e-mails the acceptance link to the invited address,
 *   as the last step - after validation, the permission check, the
 *   organization-scoped contact lookup and the conflict checks, and after the
 *   invitation is stored.
 * - It is attempted once per invitation. Nothing but that request ever holds the
 *   raw token, so nothing else can send the link again.
 * - A failed delivery does not invalidate the invitation and is never reported
 *   as sent: the response and the audit trail say what happened, and the
 *   administrator still receives the link once to hand over.
 *
 * One live invitation per organization and recipient (Phase 4D / Batch 4C-2,
 * docs/phase-4d/client-invitation-concurrency.md):
 * - The invariant is enforced by the database, not by the read-then-insert check
 *   below: the partial unique index `ClientInvitation_pending_org_email_key`
 *   (migration `0020`) allows at most one row with `status = 'pending'` per
 *   (`organizationId`, lower(email)). Two application instances, two concurrent
 *   requests, or a retry that overlaps the first attempt can therefore never
 *   both insert a live invitation.
 * - The losing request is answered 409 with the same message the pre-check
 *   gives, before it holds a token and before any e-mail is attempted, so a
 *   collision never yields a second usable link or a second message.
 * - Pending rows whose window has closed are retired to `expired` in the same
 *   transaction that inserts the replacement: an expired link can never be
 *   accepted, so it must not occupy the live-invitation slot for ever. This is
 *   the same lazy transition `getClientInvitationByToken` already performs, and
 *   it keeps every row (no deletion, no rewrite of history).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';

import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import { sendClientInvitationEmail } from '@/lib/email/invitation-emails';
import {
  deliveryAuditRecord,
  summarizeDelivery,
  type EmailDeliveryResult,
} from '@/lib/email/types';
import { CLIENT_ROLE_PRESETS } from '@/lib/portal/capabilities';
import { codedError } from '@/lib/portal/access-control';
import { writePortalAudit } from '@/lib/portal/audit';
import { notifyUser } from '@/lib/portal/notify';
import { requireInternalActor, type InternalActor } from '@/lib/portal/internal-actor';
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

/** The columns of a freshly inserted invitation that this module reads back. */
interface CreatedClientInvitationRow {
  id: string;
  email: string;
  contactId: string;
  status: string;
  role: string;
  expiresAt: Date;
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

/**
 * The partial unique index that allows at most one live invitation per
 * organization and recipient (migration `0020`, docs/phase-4d/
 * client-invitation-concurrency.md). It is created in SQL because Prisma cannot
 * express a partial index, so a collision arrives as a unique violation rather
 * than as a schema-declared `@@unique`.
 */
const PENDING_INVITATION_INDEX = 'ClientInvitation_pending_org_email_key';

/** Every string a driver/engine attached to an error, including its causes. */
function errorTextChain(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      message?: unknown;
      detail?: unknown;
      constraint?: unknown;
      meta?: { target?: unknown; message?: unknown };
      cause?: unknown;
    };
    if (typeof candidate.code === 'string') parts.push(`code:${candidate.code}`);
    for (const value of [
      candidate.message,
      candidate.detail,
      candidate.constraint,
      candidate.meta?.message,
      candidate.meta?.target,
    ]) {
      if (typeof value === 'string') parts.push(value);
      else if (Array.isArray(value)) parts.push(value.join(','));
    }
    current = candidate.cause;
  }
  return parts.join(' ');
}

/**
 * Is this the database rejecting a second live invitation for the same
 * organization and recipient?
 *
 * Prisma's engine reports a Postgres 23505 as `P2002`; the driver-adapter path
 * can surface `23505` itself. Both are recognised. A unique violation on this
 * insert can only come from the pending-invitation index (`tokenHash` is a
 * 256-bit random value), but the index name and columns are checked explicitly
 * so an unrelated violation is rethrown instead of being reported as a
 * duplicate.
 */
function isPendingInvitationConflict(error: unknown): boolean {
  const text = errorTextChain(error);
  const uniqueViolation = /\bcode:(P2002|23505)\b/.test(text) || /unique constraint/i.test(text);
  if (!uniqueViolation) return false;
  return (
    text.includes(PENDING_INVITATION_INDEX) ||
    (text.includes('organizationId') && text.includes('email')) ||
    !/tokenhash/i.test(text)
  );
}

function contactName(contact: { firstName: string | null; lastName: string }): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
}

/**
 * E-mail the acceptance link. Never throws: the invitation is already stored
 * and its one-time link must still reach the administrator, so a sender that
 * fails in a way it should not is reported as a failed delivery instead.
 */
async function deliverInvitationEmail(
  delivery: Parameters<typeof sendClientInvitationEmail>[0]
): Promise<EmailDeliveryResult> {
  try {
    return await sendClientInvitationEmail(delivery);
  } catch (error) {
    console.error('[email] the invitation e-mail could not be handed over', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'failed', reason: 'unknown', attempts: 0 };
  }
}

/**
 * Record the outcome of the invitation e-mail in the audit trail.
 *
 * Best effort by design: the invitation is already stored and its one-time link
 * must still reach the administrator, so a failed audit write is logged rather
 * than thrown. Losing the entry can only understate what was delivered.
 */
async function auditInvitationEmail(
  actor: InternalActor,
  invitationId: string,
  delivery: EmailDeliveryResult
): Promise<void> {
  const record = deliveryAuditRecord(delivery);
  if (!record) return;

  try {
    await writePortalAudit({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      actorName: actor.email,
      action: `client.invitation.${record.event}`,
      entityType: 'ClientInvitation',
      entityId: invitationId,
      after: record.details,
    });
  } catch {
    console.error('[email] could not record a delivery outcome in the audit trail', {
      entityType: 'ClientInvitation',
      entityId: invitationId,
      event: record.event,
    });
  }
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
 * Invite a CRM contact into the portal and e-mail them the acceptance link.
 *
 * The raw token is returned exactly once. `emailDelivery` in the result says
 * whether the message was accepted by the mail server (`sent`), could not be
 * delivered (`failed`, with a reason) or was not attempted because delivery is
 * switched off (`disabled`).
 */
export async function createClientInvitation(input: unknown) {
  const parsed = clientInvitationCreateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const actor = await requireInternalActor('client.invitation.create');
  const { email, contactId, role } = parsed.data;

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: actor.organizationId, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      accountId: true,
      // The name shown in the invitation e-mail. Read through the contact, so it
      // can only ever be the name of the organization that owns the contact.
      organization: { select: { name: true } },
    },
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

  // One live invitation per (org, e-mail). This read is the friendly fast path
  // only: two requests can both pass it, so the database index below is what
  // actually decides. The address is compared case-insensitively, exactly like
  // the index and like `emailsMatch` compare it everywhere else.
  const live = await prisma.clientInvitation.findFirst({
    where: {
      organizationId: actor.organizationId,
      email: { equals: email, mode: 'insensitive' },
      status: 'pending',
    },
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

  let invitation: CreatedClientInvitationRow;
  try {
    invitation = await prisma.$transaction(async (tx: typeof prisma) => {
      // A pending row whose window has closed can never be accepted, so it must
      // not hold the single live-invitation slot. Retire it in the same
      // transaction that inserts the replacement: the row, its token hash and
      // its history stay exactly where they are (no deletion, only the same
      // `pending -> expired` transition `getClientInvitationByToken` performs).
      await tx.$executeRaw`
        UPDATE "ClientInvitation"
           SET "status" = 'expired',
               "updatedAt" = NOW()
         WHERE "organizationId" = ${actor.organizationId}
           AND lower("email") = ${email}
           AND "status" = 'pending'
           AND "expiresAt" <= (NOW() AT TIME ZONE 'UTC')
      `;

      return tx.clientInvitation.create({
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
    });
  } catch (error) {
    // Two requests that both passed the fast path race here. Exactly one
    // insert can commit; the other is answered 409 before it holds a token and
    // before any e-mail is attempted, so a losing request can never yield a
    // second usable link or a second message.
    if (isPendingInvitationConflict(error)) {
      throw codedError('A pending invitation already exists for this address', 409);
    }
    throw error;
  }

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: 'client.invitation.create',
    entityType: 'ClientInvitation',
    entityId: invitation.id,
    after: { email, contactId: contact.id, role, expiresAt, ...flags },
  });

  const acceptPath = `/portal/invite/${token}`;

  // Every check above has passed and the invitation is stored: only now is the
  // e-mail attempted. It never throws, and a failure leaves the invitation
  // valid - the outcome is reported, not hidden and not assumed.
  const delivery = await deliverInvitationEmail({
    organizationId: actor.organizationId,
    // Optional access on purpose: `prisma` is untyped here, and nothing after
    // the insert may throw - the stored invitation's link would be lost.
    organizationName: contact.organization?.name ?? '',
    to: invitation.email,
    recipientName: contact.firstName,
    acceptPath,
    expiresAt,
  });
  await auditInvitationEmail(actor, invitation.id, delivery);

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
    acceptPath,
    emailDelivery: summarizeDelivery(delivery),
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
    select: { id: true, organizationId: true, userType: true, status: true, emailVerified: true },
  });
  if (!user) throw codedError('Unauthenticated', 401);
  if (user.status !== 'active') throw codedError('This account is disabled', 403);
  if (!user.emailVerified) {
    throw codedError('Verify ownership of this email address before accepting the invitation', 403);
  }

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
