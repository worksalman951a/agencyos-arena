/**
 * Portal notifications.
 *
 * Reuses the platform `Notification` + `NotificationPreference` models and the
 * existing preference evaluation, so a client or a teammate who muted a type is
 * never notified. Delivery stays in-app (no SMTP in this phase, ADR-0002).
 */

import { prisma } from '@/lib/db';
import { isNotificationAllowed } from '@/lib/services/automation/notification-service';

const IN_APP = 'in_app';

export interface PortalNotificationInput {
  organizationId: string;
  userId: string;
  type: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string;
}

/** Create one in-app notification, honouring the recipient's preferences. */
export async function notifyUser(input: PortalNotificationInput): Promise<void> {
  const allowed = await isNotificationAllowed(
    input.organizationId,
    input.userId,
    input.type,
    IN_APP
  );
  if (!allowed) return;

  if (input.dedupeKey) {
    const existing = await prisma.notification.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        type: input.type,
        dedupeKey: input.dedupeKey,
      },
      select: { id: true },
    });
    if (existing) return;
  }

  try {
    await prisma.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        type: input.type,
        channel: IN_APP,
        read: false,
        payload: (input.payload ?? null) as object | undefined,
        dedupeKey: input.dedupeKey ?? null,
        sentAt: new Date(),
      },
    });
  } catch {
    // A concurrent insert hit the dedupe index: the notification exists, which
    // is exactly what the caller asked for.
  }
}

/**
 * Notify every internal member of the organization who holds `permissionCode`.
 *
 * Recipients are resolved from the organization's own role grants (never from a
 * request payload), so a client cannot address arbitrary teammates.
 */
export async function notifyInternalStaff(input: {
  organizationId: string;
  permissionCode: string;
  type: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string;
  excludeUserId?: string | null;
}): Promise<void> {
  const grants = (await prisma.userRole.findMany({
    where: {
      organizationId: input.organizationId,
      role: {
        organizationId: input.organizationId,
        permissions: { some: { permission: { code: input.permissionCode } } },
      },
      user: { userType: 'internal', status: 'active' },
    },
    select: { userId: true },
  })) as Array<{ userId: string }>;

  const recipients = Array.from(new Set(grants.map((grant) => grant.userId))).filter(
    (userId: string) => userId !== input.excludeUserId
  );

  await Promise.all(
    recipients.map((userId) =>
      notifyUser({
        organizationId: input.organizationId,
        userId,
        type: input.type,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
      })
    )
  );
}
