/**
 * Client-portal access control (server-only).
 *
 * This is the portal's single authorization chokepoint. Every client-facing
 * service and page resolves its identity here, and nothing else decides whether a
 * client may read or act on a resource.
 *
 * Guarantees, in order of evaluation:
 * 1. A Better Auth session must exist (401 otherwise).
 * 2. The session user must be a *client* identity: `userType = "client"`, no
 *    organization membership and no `UserRole` rows. An internal user therefore
 *    cannot reach portal services, and a client can never inherit internal
 *    permissions — the internal path (`requireOrganization` + RBAC) rejects
 *    clients by construction (`lib/permissions.ts`).
 * 3. `ClientAccess.status` must be `active` (suspended/revoked -> 403) and the
 *    underlying `User.status` must be `active`.
 * 4. Every resource read passes through `requireGrantedResource`, which matches
 *    the grant on (client access, organization, resource type, resource id) and
 *    additionally re-checks that the resource exists *in that organization*.
 *    Possession of an internal record id therefore grants nothing.
 *
 * Errors carry `statusCode` and are deliberately non-disclosing: a resource that
 * exists in another tenant and one that does not exist are both 404.
 */

import { cookies } from 'next/headers';

import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth-server';
import {
  LEAST_PRIVILEGE_FLAGS,
  hasCapability,
  isClientAccessUsable,
  type ClientCapability,
  type ClientCapabilityFlags,
} from '@/lib/portal/capabilities';
import {
  RESOURCE_REQUIRED_CAPABILITY,
  type PortalResourceType,
} from '@/lib/portal/resource-registry';
import {
  findResourceInOrganization,
  type PortalResourceSummary,
} from '@/lib/portal/resource-lookup';

export function codedError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export interface PortalAccessContext extends ClientCapabilityFlags {
  userId: string;
  email: string;
  name: string | null;
  accessId: string;
  organizationId: string;
  organizationName: string;
  contactId: string;
  contactName: string;
  role: string;
  status: string;
}

/** The signed-in Better Auth user id, or null. */
async function currentSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });
  if (!result?.session || !result.user) return null;
  return result.user.id;
}

/**
 * Resolve the portal context without throwing.
 *
 * Returns `null` for "not signed in at all"; throws 403 for a signed-in user who
 * is not an active client (so the layout can distinguish "show the login page"
 * from "your access was revoked").
 */
export async function getPortalAccessOrNull(): Promise<PortalAccessContext | null> {
  const userId = await currentSessionUserId();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      userType: true,
      organizationId: true,
    },
  });

  if (!user) throw codedError('Unauthenticated', 401);

  const access = await prisma.clientAccess.findUnique({
    where: { userId },
    include: {
      organization: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // A client identity without an access row is a broken/revoked state, not an
  // internal user: report it as forbidden rather than falling through to the
  // internal application.
  if (user.userType !== 'client' || !access) {
    throw codedError('Forbidden', 403);
  }

  // Defense in depth: if a client user ever acquired an organization membership
  // or an internal role, refuse to serve the portal with that identity.
  if (user.organizationId !== null) {
    throw codedError('Forbidden', 403);
  }

  if (user.status !== 'active' || !isClientAccessUsable(access.status)) {
    throw codedError('Forbidden', 403);
  }

  if (access.organizationId !== access.organization.id) {
    throw codedError('Forbidden', 403);
  }

  const name = [access.contact.firstName, access.contact.lastName].filter(Boolean).join(' ').trim();

  return {
    userId: user.id,
    email: user.email,
    name: user.name ?? null,
    accessId: access.id,
    organizationId: access.organizationId,
    organizationName: access.organization.name,
    contactId: access.contactId,
    contactName: name || (user.name ?? user.email),
    role: access.role,
    status: access.status,
    canViewInvoices: access.canViewInvoices,
    canDownloadFiles: access.canDownloadFiles,
    canComment: access.canComment,
    canApprove: access.canApprove,
  };
}

/** Require an active client session (401 unauthenticated, 403 otherwise). */
export async function requirePortalAccess(): Promise<PortalAccessContext> {
  const userId = await currentSessionUserId();
  if (!userId) throw codedError('Unauthenticated', 401);
  const context = await getPortalAccessOrNull();
  if (!context) throw codedError('Unauthenticated', 401);
  return context;
}

/** Require a specific client capability flag. */
export async function requirePortalCapability(
  capability: ClientCapability
): Promise<PortalAccessContext> {
  const context = await requirePortalAccess();
  if (!hasCapability(context, capability)) {
    throw codedError('Forbidden', 403);
  }
  return context;
}

/** Capability flags of a context, for UI decisions. */
export function capabilityFlags(context: PortalAccessContext): ClientCapabilityFlags {
  return {
    canViewInvoices: context.canViewInvoices,
    canDownloadFiles: context.canDownloadFiles,
    canComment: context.canComment,
    canApprove: context.canApprove,
  };
}

export interface GrantedResource {
  grant: {
    id: string;
    canComment: boolean;
    canApprove: boolean;
    note: string | null;
    sharedAt: Date;
  };
  resource: PortalResourceSummary;
}

export interface GrantRequirement {
  /** Capability needed to act (comment/approve), in addition to the grant. */
  action?: 'read' | 'comment' | 'approve';
}

/**
 * Resolve a resource the client was explicitly granted, or throw 404.
 *
 * The grant lookup is scoped by the portal context's own client access id and
 * organization id, so neither a forged resource id nor a guessed grant id can
 * widen access. A grant whose resource no longer exists in the organization is
 * treated as absent.
 */
export async function requireGrantedResource(
  context: PortalAccessContext,
  type: PortalResourceType,
  resourceId: string,
  requirement: GrantRequirement = {}
): Promise<GrantedResource> {
  const requiredCapability = RESOURCE_REQUIRED_CAPABILITY[type];
  if (requiredCapability && !hasCapability(context, requiredCapability)) {
    // Deny before touching the database: no capability, no resource probing.
    throw codedError('Not found', 404);
  }

  const grant = await prisma.clientResourceGrant.findFirst({
    where: {
      organizationId: context.organizationId,
      clientAccessId: context.accessId,
      resourceType: type,
      resourceId,
      revokedAt: null,
    },
    select: {
      id: true,
      canComment: true,
      canApprove: true,
      note: true,
      sharedAt: true,
    },
  });

  if (!grant) throw codedError('Not found', 404);

  const action = requirement.action ?? 'read';
  if (action === 'comment') {
    if (!hasCapability(context, 'comment') || !grant.canComment) {
      throw codedError('Forbidden', 403);
    }
  }
  if (action === 'approve') {
    if (!hasCapability(context, 'approve') || !grant.canApprove) {
      throw codedError('Forbidden', 403);
    }
  }

  const resource = await findResourceInOrganization(type, resourceId, context.organizationId);
  if (!resource) throw codedError('Not found', 404);

  return { grant, resource };
}

/** Resource ids of one type that are granted to the client and still live. */
export async function listGrantedResourceIds(
  context: PortalAccessContext,
  type: PortalResourceType
): Promise<string[]> {
  const grants = (await prisma.clientResourceGrant.findMany({
    where: {
      organizationId: context.organizationId,
      clientAccessId: context.accessId,
      resourceType: type,
      revokedAt: null,
    },
    select: { resourceId: true },
    orderBy: { sharedAt: 'desc' },
  })) as Array<{ resourceId: string }>;
  return grants.map((grant) => grant.resourceId);
}

/** Record portal activity for the admin audit trail (best effort). */
export async function touchClientAccess(
  accessId: string,
  lastAccessAt: Date | null
): Promise<void> {
  const now = Date.now();
  if (lastAccessAt && now - lastAccessAt.getTime() < 5 * 60 * 1000) return;
  await prisma.clientAccess
    .update({ where: { id: accessId }, data: { lastAccessAt: new Date(now) } })
    .catch(() => undefined);
}

export const PORTAL_EMPTY_FLAGS = LEAST_PRIVILEGE_FLAGS;
