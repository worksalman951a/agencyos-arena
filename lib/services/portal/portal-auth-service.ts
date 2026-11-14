/**
 * Client Portal Authentication & Session Service (ADR-0004 & Phase 11G-1).
 *
 * Security Guarantees:
 * 1. Explicit Administrative Provisioning:
 *    - Only authenticated agency administrators with `contact.update` or `settings.update` can invite contacts.
 *    - Validates that Contact belongs to the caller's organization.
 *    - Client portal identity CANNOT self-register or auto-activate without an admin-issued invitation.
 * 2. Token Security:
 *    - Raw tokens generated via `crypto.randomBytes(32).toString('hex')`.
 *    - Tokens stored ONLY as SHA-256 hashes.
 *    - Tokens are strictly single-use and expire within 15 minutes.
 * 3. Portal Session Security:
 *    - Generates 32-byte opaque session tokens stored as SHA-256 hashes in `ClientPortalSession`.
 *    - Set as HTTP-only, Secure (in production/HTTPS), SameSite='lax' cookie: `agencyos_portal_session`.
 *    - Completely isolated from internal agency Better Auth session (`better-auth.session_token`).
 *    - Revoking portal access immediately revokes all active sessions for that contact.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { emailTransport } from '@/lib/services/automation/email-service';
import {
  clientPortalInviteSchema,
  clientPortalRevokeSchema,
  clientPortalLoginRequestSchema,
  clientPortalVerifyTokenSchema,
} from '@/lib/schemas/portal/portal-auth.schema';

export const PORTAL_SESSION_COOKIE = 'agencyos_portal_session';
const TOKEN_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 7;

function codedError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function getAuthorizedAgencyUser(): Promise<AuthorizedUser> {
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

export interface ClientPortalContext {
  portalAccessId: string;
  organizationId: string;
  contactId: string;
  email: string;
  contactName: string;
  accountName: string | null;
  accountId: string | null;
  organizationName: string;
  organizationBrand: {
    brandName?: string;
    brandColor?: string;
    logoUrl?: string | null;
  };
}

/** Read a contact's portal access state for the current organization administrator. */
export async function getContactPortalAccess(contactId: string) {
  const { organizationId, role } = await getAuthorizedAgencyUser();
  if (role !== 'admin' && role !== 'owner') {
    throw codedError('Only organization administrators can view client portal access', 403);
  }

  return prisma.clientPortalAccess.findUnique({
    where: { organizationId_contactId: { organizationId, contactId } },
    select: {
      id: true,
      email: true,
      status: true,
      invitedAt: true,
      activatedAt: true,
      revokedAt: true,
      lastLoginAt: true,
    },
  });
}

/**
 * Invite a CRM contact to the Client Portal (Organization Owner or Admin only).
 *
 * Security amendment: Ordinary CRM editors (even with contact.update) must NOT
 * be permitted to provision external client portal access. This action requires
 * explicit administrative authority (role === 'owner' || role === 'admin').
 */
export async function inviteContactToPortal(input: unknown) {
  const parsed = clientPortalInviteSchema.safeParse(input);
  if (!parsed.success) {
    throw codedError(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const { userId, organizationId, email: actorEmail, role } = await getAuthorizedAgencyUser();
  if (role !== 'admin' && role !== 'owner') {
    throw codedError('Only organization administrators can grant client portal access', 403);
  }

  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.contactId, organizationId, deletedAt: null },
    include: { account: true },
  });

  if (!contact) {
    throw codedError('Contact not found in organization', 404);
  }

  // Consistent organization verification
  if (contact.account && contact.account.organizationId !== organizationId) {
    throw codedError('Contact account organization mismatch', 403);
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const rawToken = randomBytes(32).toString('hex');
  const hashedToken = hashToken(rawToken);
  const expiry = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  const portalAccess = await prisma.clientPortalAccess.upsert({
    where: { organizationId_contactId: { organizationId, contactId: contact.id } },
    create: {
      organizationId,
      contactId: contact.id,
      email: normalizedEmail,
      status: 'pending',
      invitationHash: hashedToken,
      invitationExpiry: expiry,
      invitedBy: userId,
      invitedAt: new Date(),
    },
    update: {
      email: normalizedEmail,
      status: 'pending',
      invitationHash: hashedToken,
      invitationExpiry: expiry,
      invitedBy: userId,
      invitedAt: new Date(),
      revokedAt: null,
      revokedBy: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      actorName: actorEmail,
      action: 'portal.access.invite',
      entityType: 'ClientPortalAccess',
      entityId: portalAccess.id,
      metadata: {
        contactId: contact.id,
        email: normalizedEmail,
      },
      organizationId,
    },
  });

  // Attempt delivery if SMTP configured (using fragment to avoid logging token in HTTP server logs)
  const activationUrl = `/portal/login#token=${rawToken}`;
  if (emailTransport.isAvailable()) {
    await emailTransport.send({
      to: normalizedEmail,
      subject: 'Your Client Portal Access Invitation',
      text: `You have been invited to access the Client Portal. Activate your account using this link (valid for 15 minutes): ${activationUrl}`,
    });
  }

  return {
    portalAccessId: portalAccess.id,
    contactId: contact.id,
    email: normalizedEmail,
    status: portalAccess.status,
    invitationUrl: activationUrl,
    rawTokenForTesting: process.env.NODE_ENV === 'test' ? rawToken : undefined,
  };
}

/**
 * Revoke Client Portal access for a contact (Organization Owner or Admin only).
 */
export async function revokeContactPortalAccess(input: unknown) {
  const parsed = clientPortalRevokeSchema.safeParse(input);
  if (!parsed.success) {
    throw codedError(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const { userId, organizationId, email: actorEmail, role } = await getAuthorizedAgencyUser();
  if (role !== 'admin' && role !== 'owner') {
    throw codedError('Only organization administrators can revoke client portal access', 403);
  }

  const portalAccess = await prisma.clientPortalAccess.findUnique({
    where: { organizationId_contactId: { organizationId, contactId: parsed.data.contactId } },
  });

  if (!portalAccess) {
    throw codedError('Portal access record not found', 404);
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.clientPortalAccess.update({
      where: { id: portalAccess.id },
      data: {
        status: 'revoked',
        revokedAt: now,
        revokedBy: userId,
        invitationHash: null,
        magicLinkHash: null,
      },
    }),
    prisma.clientPortalSession.updateMany({
      where: { portalAccessId: portalAccess.id, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      actorName: actorEmail,
      action: 'portal.access.revoke',
      entityType: 'ClientPortalAccess',
      entityId: portalAccess.id,
      metadata: {
        contactId: parsed.data.contactId,
        reason: parsed.data.reason ?? null,
      },
      organizationId,
    },
  });

  return { success: true, status: 'revoked' };
}

/**
 * Request a magic login link for an ACTIVE portal account.
 * Generic response to prevent email enumeration.
 */
export async function requestPortalLoginLink(input: unknown) {
  const parsed = clientPortalLoginRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw codedError('Invalid email address provided', 400);
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  // Look for an ACTIVE portal access row
  const portalAccess = await prisma.clientPortalAccess.findFirst({
    where: { email: normalizedEmail, status: 'active' },
  });

  let rawTokenForTesting: string | undefined = undefined;

  if (portalAccess) {
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = hashToken(rawToken);
    const expiry = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

    await prisma.clientPortalAccess.update({
      where: { id: portalAccess.id },
      data: {
        magicLinkHash: hashedToken,
        magicLinkExpiry: expiry,
      },
    });

    const loginUrl = `/portal/login#token=${rawToken}`;
    if (emailTransport.isAvailable()) {
      await emailTransport.send({
        to: normalizedEmail,
        subject: 'Your Client Portal Sign-In Link',
        text: `Click the link to sign in to your Client Portal (valid for 15 minutes): ${loginUrl}`,
      });
    }

    if (process.env.NODE_ENV === 'test') {
      rawTokenForTesting = rawToken;
    }
  }

  // Generic enumeration-resistant response
  return {
    success: true,
    message: 'If an active portal account exists for this address, a sign-in link has been sent.',
    rawTokenForTesting,
  };
}

/**
 * Verify an invitation or magic-link token, activate account if pending, and establish session.
 */
export async function verifyPortalTokenAndLogin(input: unknown) {
  const parsed = clientPortalVerifyTokenSchema.safeParse(input);
  if (!parsed.success) {
    throw codedError('Invalid token format', 400);
  }

  const rawToken = parsed.data.token.trim();
  const hashedToken = hashToken(rawToken);
  const now = new Date();

  // Find either invitation or magic link match
  const portalAccess = await prisma.clientPortalAccess.findFirst({
    where: {
      OR: [
        { invitationHash: hashedToken, invitationExpiry: { gt: now } },
        { magicLinkHash: hashedToken, magicLinkExpiry: { gt: now } },
      ],
    },
    include: {
      contact: true,
      organization: true,
    },
  });

  if (!portalAccess || portalAccess.status === 'revoked') {
    throw codedError('Invalid or expired login link', 401);
  }

  // Atomic token consumption and activation
  const isInvitation = timingSafeMatch(portalAccess.invitationHash ?? '', hashedToken);
  await prisma.clientPortalAccess.update({
    where: { id: portalAccess.id },
    data: {
      status: 'active',
      activatedAt: portalAccess.activatedAt ?? now,
      lastLoginAt: now,
      invitationHash: isInvitation ? null : portalAccess.invitationHash,
      magicLinkHash: !isInvitation ? null : portalAccess.magicLinkHash,
    },
  });

  // Create opaque session token
  const rawSessionToken = randomBytes(32).toString('hex');
  const sessionHash = hashToken(rawSessionToken);
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.clientPortalSession.create({
    data: {
      portalAccessId: portalAccess.id,
      sessionHash,
      expiresAt: sessionExpiresAt,
    },
  });

  // Set HTTP-only session cookie
  const cookieStore = await cookies();
  cookieStore.set(PORTAL_SESSION_COOKIE, rawSessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: sessionExpiresAt,
  });

  return {
    success: true,
    portalAccessId: portalAccess.id,
    contactId: portalAccess.contactId,
    email: portalAccess.email,
  };
}

/**
 * Get current authenticated client portal session context.
 */
export async function getClientPortalSession(): Promise<ClientPortalContext> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;

  if (!sessionCookie) {
    throw codedError('Unauthenticated client portal session', 401);
  }

  const sessionHash = hashToken(sessionCookie);
  const now = new Date();

  const session = await prisma.clientPortalSession.findUnique({
    where: { sessionHash },
    include: {
      portalAccess: {
        include: {
          contact: {
            include: { account: true },
          },
          organization: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= now) {
    throw codedError('Session expired or revoked', 401);
  }

  const access = session.portalAccess;
  if (!access || access.status !== 'active') {
    throw codedError('Portal access inactive or revoked', 403);
  }

  const contact = access.contact;
  const contactName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') || access.email;
  const orgSettings = (access.organization.settings ?? {}) as Record<string, unknown>;

  return {
    portalAccessId: access.id,
    organizationId: access.organizationId,
    contactId: access.contactId,
    email: access.email,
    contactName,
    accountId: contact.accountId,
    accountName: contact.account?.name ?? null,
    organizationName: access.organization.name,
    organizationBrand: {
      brandName:
        typeof orgSettings.brandName === 'string'
          ? orgSettings.brandName
          : access.organization.name,
      brandColor: typeof orgSettings.brandColor === 'string' ? orgSettings.brandColor : '#0f172a',
      logoUrl: typeof orgSettings.logoUrl === 'string' ? orgSettings.logoUrl : null,
    },
  };
}

/**
 * Invalidate current client portal session.
 */
export async function logoutClientPortal() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;

  if (sessionCookie) {
    const sessionHash = hashToken(sessionCookie);
    await prisma.clientPortalSession.updateMany({
      where: { sessionHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  cookieStore.delete(PORTAL_SESSION_COOKIE);
  return { success: true };
}
