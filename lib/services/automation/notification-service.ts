'use server';

/**
 * In-app notification service.
 *
 * Security model (ADR-0004, hybrid RBAC + resource scoping):
 * - every query is scoped to the actor's organization;
 * - a user reads and marks read only their own notifications;
 * - creating a notification for somebody else, and listing another user's
 *   notifications, requires `notification.update` plus `user.read` — an admin
 *   capability, not something a peer can do.
 *
 * Data integrity:
 * - `dedupeKey` makes notification creation idempotent. A retried workflow
 *   action or a double-submitted form cannot create the same notification
 *   twice (unique index on organizationId+userId+type+dedupeKey).
 * - `NotificationPreference` is consulted before inserting, so a user who muted
 *   a type or channel never receives it in the first place.
 */

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  DEFAULT_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNELS,
  notificationCreateSchema,
  notificationPreferenceUpdateSchema,
} from '@/lib/schemas/automation/notification.schema';

export interface NotificationResponse {
  id: string;
  organizationId: string;
  userId: string;
  type: string;
  channel: string;
  read: boolean;
  payload: Record<string, unknown> | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface NotificationPreferenceResponse {
  channels: Record<string, boolean>;
  mutedTypes: string[];
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    const error = new Error('Unauthenticated') as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
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

async function createAuditLog({
  actorId,
  actorName,
  action,
  entityType,
  entityId,
  before,
  after,
  metadata,
  organizationId,
}: {
  actorId: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  organizationId: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorId,
      actorName,
      action,
      entityType,
      entityId,
      before: before ?? null,
      after: after ?? null,
      metadata: metadata ?? null,
      organizationId,
    },
  });
}

function notFound(message = 'Not found') {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function serialize(notification: {
  id: string;
  organizationId: string;
  userId: string;
  type: string;
  channel: string;
  read: boolean;
  payload: unknown;
  sentAt: Date | null;
  createdAt: Date;
}): NotificationResponse {
  return {
    id: notification.id,
    organizationId: notification.organizationId,
    userId: notification.userId,
    type: notification.type,
    channel: notification.channel,
    read: notification.read,
    payload: (notification.payload ?? null) as Record<string, unknown> | null,
    sentAt: notification.sentAt,
    createdAt: notification.createdAt,
  };
}

/**
 * List notifications.
 *
 * Without `userId` this returns the actor's own notifications, which is the
 * notification-centre case and needs only `notification.read`. Asking for
 * somebody else's requires both `notification.update` and `user.read`.
 */
export async function listNotifications(userId?: string) {
  const { userId: actorUserId, organizationId } = await getAuthorizedUser();

  await requirePermission(actorUserId, organizationId, 'notification.read');

  const targetUserId = userId ?? actorUserId;

  if (targetUserId !== actorUserId) {
    await requirePermission(actorUserId, organizationId, 'notification.update');
    await requirePermission(actorUserId, organizationId, 'user.read');
  }

  const notifications = await prisma.notification.findMany({
    where: { organizationId, userId: targetUserId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return notifications.map(serialize);
}

export async function getNotification(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'notification.read');

  const notification = await prisma.notification.findFirst({
    where: { id, organizationId },
  });

  if (!notification) throw notFound();

  if (notification.userId !== userId) {
    await requirePermission(userId, organizationId, 'notification.update');
    await requirePermission(userId, organizationId, 'user.read');
  }

  return serialize(notification);
}

/**
 * Mark a notification read.
 *
 * Deliberately allowed for the owner with only `notification.read`: marking
 * your own notification read is not a write to somebody else's data, and
 * requiring `notification.update` here locked read-only roles out of the
 * notification centre (the "Mark Read" button answered 403).
 */
export async function markNotificationRead(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'notification.read');

  const notification = await prisma.notification.findFirst({
    where: { id, organizationId },
  });

  if (!notification) throw notFound();

  if (notification.userId !== userId) {
    await requirePermission(userId, organizationId, 'notification.update');
    await requirePermission(userId, organizationId, 'user.read');
  }

  // Idempotent: marking an already-read notification read is a no-op, not a
  // second audit entry.
  if (notification.read) {
    return { id: notification.id, read: true };
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { read: true, sentAt: notification.sentAt ?? new Date() },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'notification.read',
    entityType: 'Notification',
    entityId: id,
    before: { id, read: false },
    after: { id, read: true },
    organizationId,
  });

  return { id: updated.id, read: updated.read };
}

/** Mark every unread notification of the actor as read. */
export async function markAllNotificationsRead() {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'notification.read');

  const result = await prisma.notification.updateMany({
    where: { organizationId, userId, read: false },
    data: { read: true },
  });

  return { updated: result.count };
}

/** Read the actor's (or, with user.read + notification.update, a peer's) preferences. */
export async function getNotificationPreferences(userId?: string) {
  const { userId: actorUserId, organizationId } = await getAuthorizedUser();

  await requirePermission(actorUserId, organizationId, 'notification.read');

  const targetUserId = userId ?? actorUserId;
  if (targetUserId !== actorUserId) {
    await requirePermission(actorUserId, organizationId, 'notification.update');
    await requirePermission(actorUserId, organizationId, 'user.read');
  }

  const preference = await prisma.notificationPreference.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
  });

  return {
    userId: targetUserId,
    channels: {
      ...DEFAULT_NOTIFICATION_CHANNELS,
      ...((preference?.channels ?? {}) as Record<string, boolean>),
    },
    mutedTypes: preference?.mutedTypes ?? [],
  } satisfies NotificationPreferenceResponse & { userId: string };
}

/** Update the actor's preferences (own preferences only — no admin override). */
export async function updateNotificationPreferences(input: unknown) {
  const parsed = notificationPreferenceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const error = new Error('Invalid request body') as Error & {
      statusCode?: number;
      issues?: unknown;
    };
    error.statusCode = 400;
    error.issues = parsed.error.issues;
    throw error;
  }

  const { userId, organizationId } = await getAuthorizedUser();
  await requirePermission(userId, organizationId, 'notification.preference');

  const unknownChannels = Object.keys(parsed.data.channels ?? {}).filter(
    (channel) => !NOTIFICATION_CHANNELS.includes(channel as (typeof NOTIFICATION_CHANNELS)[number])
  );
  if (unknownChannels.length > 0) {
    const error = new Error(`Unsupported channel: ${unknownChannels.join(', ')}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const existing = await prisma.notificationPreference.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });

  const channels = {
    ...DEFAULT_NOTIFICATION_CHANNELS,
    ...((existing?.channels ?? {}) as Record<string, boolean>),
    ...(parsed.data.channels ?? {}),
  };
  const mutedTypes = parsed.data.mutedTypes ?? existing?.mutedTypes ?? [];

  const saved = await prisma.notificationPreference.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, channels, mutedTypes },
    update: { channels, mutedTypes },
  });

  return {
    userId,
    channels: saved.channels as Record<string, boolean>,
    mutedTypes: saved.mutedTypes,
  };
}

/**
 * Is this user willing to receive this notification?
 * Internal helper shared by `createNotification` and the workflow executor.
 */
export async function isNotificationAllowed(
  organizationId: string,
  userId: string,
  type: string,
  channel: string
): Promise<boolean> {
  const preference = await prisma.notificationPreference.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!preference) return true;
  if (preference.mutedTypes.includes(type)) return false;
  const channels = {
    ...DEFAULT_NOTIFICATION_CHANNELS,
    ...((preference.channels ?? {}) as Record<string, boolean>),
  };
  return channels[channel] !== false;
}

export async function createNotification(input: unknown) {
  const parsed = notificationCreateSchema.safeParse(input);
  if (!parsed.success) {
    const error = new Error('Invalid request body') as Error & {
      statusCode?: number;
      issues?: unknown;
    };
    error.statusCode = 400;
    error.issues = parsed.error.issues;
    throw error;
  }

  const { userId: actorUserId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(actorUserId, organizationId, 'notification.update');

  if (parsed.data.userId !== actorUserId) {
    await requirePermission(actorUserId, organizationId, 'user.read');
  }

  // The target must belong to the actor's organization: a client-supplied user
  // id can never address another tenant.
  const targetUser = await prisma.user.findFirst({
    where: { id: parsed.data.userId, organizationId },
    select: { id: true },
  });

  if (!targetUser) throw notFound('User not found');

  const allowed = await isNotificationAllowed(
    organizationId,
    parsed.data.userId,
    parsed.data.type,
    parsed.data.channel
  );
  if (!allowed) {
    // Respecting the preference is a success, not an error: the caller asked to
    // notify, and the recipient has opted out.
    return { skipped: true as const, reason: 'preference' as const };
  }

  // Idempotent create: the unique index on (org, user, type, dedupeKey) makes a
  // retry a no-op instead of a duplicate row.
  if (parsed.data.dedupeKey) {
    const existing = await prisma.notification.findFirst({
      where: {
        organizationId,
        userId: parsed.data.userId,
        type: parsed.data.type,
        dedupeKey: parsed.data.dedupeKey,
      },
    });
    if (existing) {
      return { ...serialize(existing), duplicate: true as const };
    }
  }

  const notification = await prisma.notification.create({
    data: {
      organizationId,
      userId: parsed.data.userId,
      type: parsed.data.type,
      channel: parsed.data.channel,
      read: false,
      payload: (parsed.data.payload ?? null) as object | undefined,
      dedupeKey: parsed.data.dedupeKey ?? null,
      sentAt: parsed.data.channel === 'in_app' ? new Date() : null,
    },
  });

  await createAuditLog({
    actorId: actorUserId,
    actorName: actorEmail,
    action: 'notification.create',
    entityType: 'Notification',
    entityId: notification.id,
    after: {
      id: notification.id,
      userId: notification.userId,
      type: notification.type,
      channel: notification.channel,
    },
    organizationId,
  });

  return serialize(notification);
}

export async function getUnreadCount(userId?: string) {
  const { userId: actorUserId, organizationId } = await getAuthorizedUser();

  await requirePermission(actorUserId, organizationId, 'notification.read');

  const targetUserId = userId ?? actorUserId;
  if (targetUserId !== actorUserId) {
    await requirePermission(actorUserId, organizationId, 'notification.update');
    await requirePermission(actorUserId, organizationId, 'user.read');
  }

  const count = await prisma.notification.count({
    where: { organizationId, userId: targetUserId, read: false },
  });

  return { count };
}
