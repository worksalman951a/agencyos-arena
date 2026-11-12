'use server';

/**
 * Feedback and comments on shared resources.
 *
 * Two visibilities share one table:
 * - `client`  : visible to the client and the team (the conversation).
 * - `internal`: team-only notes; never returned by any client-facing query.
 *
 * A client can only write `client` comments on a resource that is actively
 * granted to it and only when both its `comment` capability and the grant allow
 * commenting. Comments are immutable (no update/delete endpoints), so the record
 * of what a client said stays intact.
 */

import { prisma } from '@/lib/db';
import {
  codedError,
  requireGrantedResource,
  requirePortalCapability,
  type PortalAccessContext,
} from '@/lib/portal/access-control';
import { writePortalAudit } from '@/lib/portal/audit';
import { notifyInternalStaff, notifyUser } from '@/lib/portal/notify';
import { requireInternalActor } from '@/lib/portal/internal-actor';
import {
  canCommentOn,
  isPortalResourceType,
  type PortalResourceType,
} from '@/lib/portal/resource-registry';
import { clientCommentCreateSchema } from '@/lib/schemas/portal/client-portal.schema';

interface CommentRow {
  id: string;
  resourceType: string;
  resourceId: string;
  authorType: string;
  visibility: string;
  body: string;
  createdAt: Date;
  author: { name: string | null; email: string };
}

interface InternalCommentRow extends CommentRow {
  clientAccess: { contact: { firstName: string | null; lastName: string } } | null;
}

export interface ClientCommentView {
  id: string;
  resourceType: string;
  resourceId: string;
  authorType: string;
  authorName: string;
  visibility: string;
  body: string;
  createdAt: Date;
}

function displayName(
  user: { name: string | null; email: string } | null,
  fallback: string
): string {
  return user?.name || user?.email || fallback;
}

/**
 * Client-visible comments for a granted resource, oldest first.
 *
 * `visibility: 'client'` is part of the query, not a filter applied afterwards:
 * internal notes are never loaded for a client request.
 */
export async function listClientVisibleComments(
  context: PortalAccessContext,
  resourceType: PortalResourceType,
  resourceId: string
): Promise<ClientCommentView[]> {
  await requireGrantedResource(context, resourceType, resourceId);

  const comments = (await prisma.clientComment.findMany({
    where: {
      organizationId: context.organizationId,
      resourceType,
      resourceId,
      visibility: 'client',
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
    include: { author: { select: { name: true, email: true } } },
  })) as CommentRow[];

  return comments.map((comment) => ({
    id: comment.id,
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    authorType: comment.authorType,
    authorName:
      comment.authorType === 'client' ? context.contactName : displayName(comment.author, 'Team'),
    visibility: comment.visibility,
    body: comment.body,
    createdAt: comment.createdAt,
  }));
}

/** Client feedback on a granted resource. */
export async function createClientComment(input: unknown) {
  const parsed = clientCommentCreateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const context = await requirePortalCapability('comment');
  const { resourceType, resourceId } = parsed.data;

  if (!canCommentOn(resourceType)) {
    throw codedError('This resource does not accept comments', 400);
  }

  await requireGrantedResource(context, resourceType, resourceId, { action: 'comment' });

  const comment = await prisma.clientComment.create({
    data: {
      organizationId: context.organizationId,
      clientAccessId: context.accessId,
      resourceType,
      resourceId,
      authorUserId: context.userId,
      authorType: 'client',
      // Forced: a client can never write an internal-only note.
      visibility: 'client',
      body: parsed.data.body,
    },
  });

  await writePortalAudit({
    organizationId: context.organizationId,
    actorId: context.userId,
    actorName: context.email,
    action: 'client.comment.create',
    entityType: 'ClientComment',
    entityId: comment.id,
    after: { resourceType, resourceId, visibility: 'client' },
    metadata: { actorType: 'client' },
  });

  await notifyInternalStaff({
    organizationId: context.organizationId,
    permissionCode: 'client.comment.read',
    type: 'client.comment.created',
    payload: {
      commentId: comment.id,
      resourceType,
      resourceId,
      clientName: context.contactName,
      excerpt: parsed.data.body.slice(0, 200),
    },
    dedupeKey: `client-comment:${comment.id}`,
  });

  return {
    id: comment.id,
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    authorType: comment.authorType,
    authorName: context.contactName,
    visibility: comment.visibility,
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Internal side
// ---------------------------------------------------------------------------

/** Every comment (including internal notes) for the organization, newest first. */
export async function listCommentsForOrganization(resourceType?: PortalResourceType) {
  const actor = await requireInternalActor('client.comment.read');

  const comments = (await prisma.clientComment.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(resourceType ? { resourceType } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      author: { select: { name: true, email: true } },
      clientAccess: { select: { contact: { select: { firstName: true, lastName: true } } } },
    },
  })) as InternalCommentRow[];

  return comments.map((comment) => ({
    id: comment.id,
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    authorType: comment.authorType,
    authorName:
      comment.authorType === 'client'
        ? [comment.clientAccess?.contact.firstName, comment.clientAccess?.contact.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'Client'
        : displayName(comment.author, 'Team'),
    visibility: comment.visibility,
    body: comment.body,
    createdAt: comment.createdAt,
  }));
}

/**
 * Internal staff reply on a shared resource.
 *
 * `visibility: 'client'` posts into the conversation the client sees;
 * `visibility: 'internal'` stays team-only. The client access id is resolved
 * from the grant, never taken from the payload.
 */
export async function createInternalComment(input: unknown) {
  const parsed = clientCommentCreateSchema.safeParse(input);
  if (!parsed.success) throw codedError('Invalid request body', 400);

  const actor = await requireInternalActor('client.comment.create');
  const { resourceType, resourceId } = parsed.data;

  if (!isPortalResourceType(resourceType)) {
    throw codedError('Unknown resource type', 400);
  }

  const grant = await prisma.clientResourceGrant.findFirst({
    where: {
      organizationId: actor.organizationId,
      resourceType,
      resourceId,
      revokedAt: null,
    },
    select: { clientAccessId: true },
  });
  if (!grant) throw codedError('This resource is not shared with a client', 400);

  const comment = await prisma.clientComment.create({
    data: {
      organizationId: actor.organizationId,
      clientAccessId: grant.clientAccessId,
      resourceType,
      resourceId,
      authorUserId: actor.userId,
      authorType: 'internal',
      visibility: parsed.data.visibility ?? 'client',
      body: parsed.data.body,
    },
  });

  await writePortalAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorName: actor.email,
    action: 'client.comment.internal',
    entityType: 'ClientComment',
    entityId: comment.id,
    after: { resourceType, resourceId, visibility: comment.visibility },
  });

  // Only client-visible replies notify the client; an internal note must not
  // leak the existence of team discussion.
  if (comment.visibility === 'client') {
    const access = await prisma.clientAccess.findFirst({
      where: { id: grant.clientAccessId, organizationId: actor.organizationId },
      select: { userId: true, status: true },
    });
    if (access?.status === 'active') {
      await notifyUser({
        organizationId: actor.organizationId,
        userId: access.userId,
        type: 'client.comment.reply',
        payload: {
          commentId: comment.id,
          resourceType,
          resourceId,
          excerpt: parsed.data.body.slice(0, 200),
        },
        dedupeKey: `client-comment-reply:${comment.id}`,
      });
    }
  }

  return {
    id: comment.id,
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    authorType: comment.authorType,
    authorName: actor.email,
    visibility: comment.visibility,
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

/** Client-visible comment stream used by the portal dashboard. */
export async function listRecentClientFeedback(context: PortalAccessContext) {
  const comments = (await prisma.clientComment.findMany({
    where: {
      organizationId: context.organizationId,
      clientAccessId: context.accessId,
      visibility: 'client',
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { author: { select: { name: true, email: true } } },
  })) as CommentRow[];

  return comments.map((comment) => ({
    id: comment.id,
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    body: comment.body,
    authorType: comment.authorType,
    createdAt: comment.createdAt,
  }));
}
