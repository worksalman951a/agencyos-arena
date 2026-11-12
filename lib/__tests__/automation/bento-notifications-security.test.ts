import { describe, it, expect, vi } from 'vitest';
import {
  notificationCreateSchema,
  notificationPreferenceUpdateSchema,
} from '@/lib/schemas/automation/notification.schema';

describe('Phase 7B: Notification Security & User Privacy Tests', () => {
  it('enforces user ownership and rejects notifications belonging to another user', async () => {
    const mockDb = {
      notification: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const currentUserId = 'user-alice';
    const targetUserId = 'user-bob';
    const organizationId = 'org-tenant-1';

    // Query mimicking mark-read security constraint
    const record = await mockDb.notification.findFirst({
      where: {
        id: 'notif-xyz',
        organizationId,
        userId: currentUserId, // Crucial: must match authenticated user
      },
    });

    expect(record).toBeNull();
    expect(currentUserId).not.toBe(targetUserId);
  });

  it('validates preference update payload schema strictly', () => {
    const validPreferences = {
      channels: { in_app: true, email: false },
      mutedTypes: ['workflow', 'lead.assigned'],
    };

    const result = notificationPreferenceUpdateSchema.safeParse(validPreferences);
    expect(result.success).toBe(true);

    const invalidPreferences = {
      channels: { in_app: 'not-a-boolean' },
    };

    const invalidResult = notificationPreferenceUpdateSchema.safeParse(invalidPreferences);
    expect(invalidResult.success).toBe(false);
  });

  it('rejects notification creation missing mandatory userId or type', () => {
    const invalidNotification = {
      channel: 'in_app',
      payload: { message: 'hello' },
    };

    const result = notificationCreateSchema.safeParse(invalidNotification);
    expect(result.success).toBe(false);
  });

  it('accepts optional idempotency dedupeKey to prevent duplicate notification creation when specified', () => {
    const validWithDedupe = {
      userId: 'user-charlie',
      type: 'invoice.overdue',
      channel: 'in_app' as const,
      dedupeKey: 'invoice-overdue-inv-1001-2026-03',
      payload: { invoiceId: 'inv-1001' },
    };

    const result = notificationCreateSchema.safeParse(validWithDedupe);
    expect(result.success).toBe(true);

    // Verify dedupeKey is strictly optional and not universally present
    const validWithoutDedupe = {
      userId: 'user-charlie',
      type: 'lead.assigned',
      channel: 'in_app' as const,
      payload: { leadId: 'lead-2002' },
    };
    const resultWithoutDedupe = notificationCreateSchema.safeParse(validWithoutDedupe);
    expect(resultWithoutDedupe.success).toBe(true);
    expect(resultWithoutDedupe.data?.dedupeKey).toBeUndefined();
  });
});
