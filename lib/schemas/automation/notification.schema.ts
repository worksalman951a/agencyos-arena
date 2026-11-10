/**
 * Notification validation (pure module).
 *
 * Separate from the `'use server'` service because a server-action module may
 * only export async functions.
 */

import { z } from 'zod';

/** Channels the product supports today. Email is stored but not delivered yet. */
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;

export const DEFAULT_NOTIFICATION_CHANNELS: Record<string, boolean> = {
  in_app: true,
  email: false,
};

export const notificationPreferenceUpdateSchema = z
  .object({
    channels: z.record(z.string().max(30), z.boolean()).optional(),
    mutedTypes: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  })
  .strict();

export const notificationCreateSchema = z
  .object({
    userId: z.string().min(1, 'userId is required').max(120),
    type: z.string().trim().min(1, 'type is required').max(80),
    channel: z.enum(NOTIFICATION_CHANNELS).default('in_app'),
    payload: z.record(z.string(), z.unknown()).optional(),
    /** Optional idempotency key; the same key never creates a second row. */
    dedupeKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type NotificationCreateInput = z.infer<typeof notificationCreateSchema>;
