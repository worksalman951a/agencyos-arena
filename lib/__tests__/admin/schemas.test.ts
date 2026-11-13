/**
 * Administration and automation request schemas.
 *
 * These are the server-side contracts that make privilege escalation and silent
 * misconfiguration impossible; every route parses through them.
 */

import { describe, expect, it } from 'vitest';

import {
  adminUserUpdateSchema,
  auditLogQuerySchema,
  roleCreateSchema,
  roleUpdateSchema,
  USER_STATUSES,
} from '@/lib/schemas/admin/member.schema';
import {
  invitationAcceptSchema,
  invitationCreateSchema,
} from '@/lib/schemas/admin/invitation.schema';
import {
  notificationCreateSchema,
  notificationPreferenceUpdateSchema,
  NOTIFICATION_CHANNELS,
} from '@/lib/schemas/automation/notification.schema';

describe('member update schema', () => {
  it('accepts supported profile, status, and role changes but rejects an empty update', () => {
    expect(adminUserUpdateSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({ roleId: 'role_1' }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({ displayName: 'Teammate' }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({ avatarUrl: null }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(adminUserUpdateSchema.safeParse({ status: 'root' }).success).toBe(false);
    expect(USER_STATUSES).toEqual(['active', 'suspended', 'invited']);
  });

  it('rejects privilege fields that are not part of the contract', () => {
    // A caller cannot smuggle `organizationId` or a raw role name through.
    expect(
      adminUserUpdateSchema.safeParse({ status: 'active', organizationId: 'other-org' }).success
    ).toBe(false);
    expect(adminUserUpdateSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });

  it('rejects an empty role id', () => {
    expect(adminUserUpdateSchema.safeParse({ roleId: '' }).success).toBe(false);
  });
});

describe('role schemas', () => {
  it('requires a name on create and allows an empty permission list', () => {
    expect(roleCreateSchema.safeParse({ name: 'Manager' }).success).toBe(true);
    expect(roleCreateSchema.safeParse({ name: '' }).success).toBe(false);
    expect(roleCreateSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a partial update and rejects unknown keys', () => {
    expect(roleUpdateSchema.safeParse({ description: 'x' }).success).toBe(true);
    expect(roleUpdateSchema.safeParse({ isSystem: true }).success).toBe(false);
    expect(roleUpdateSchema.safeParse({ permissionCodes: ['invoice.read'] }).success).toBe(true);
  });

  it('bounds the permission list length', () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => `code.${index}`);
    expect(roleUpdateSchema.safeParse({ permissionCodes: tooMany }).success).toBe(false);
  });
});

describe('audit log query schema', () => {
  it('coerces pagination and bounds it', () => {
    const parsed = auditLogQuerySchema.safeParse({ page: '2', pageSize: '25' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.page).toBe(2);

    expect(auditLogQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });

  it('rejects unknown filters', () => {
    expect(auditLogQuerySchema.safeParse({ organizationId: 'x' }).success).toBe(false);
  });
});

describe('invitation schemas', () => {
  it('normalizes the invited e-mail address', () => {
    const parsed = invitationCreateSchema.safeParse({
      email: '  Teammate@Example.TEST ',
      roleId: 'role_1',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.email).toBe('teammate@example.test');
  });

  it('rejects a malformed e-mail and a missing role', () => {
    expect(invitationCreateSchema.safeParse({ email: 'not-an-email', roleId: 'r' }).success).toBe(
      false
    );
    expect(invitationCreateSchema.safeParse({ email: 'a@b.test' }).success).toBe(false);
  });

  it('requires a token of a plausible length', () => {
    expect(invitationAcceptSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(invitationAcceptSchema.safeParse({ token: 'x'.repeat(43) }).success).toBe(true);
  });
});

describe('notification schemas', () => {
  it('defaults the channel to in_app', () => {
    const parsed = notificationCreateSchema.safeParse({ userId: 'u1', type: 'mention' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.channel).toBe('in_app');
  });

  it('rejects unsupported channels and missing fields', () => {
    expect(
      notificationCreateSchema.safeParse({ userId: 'u1', type: 'x', channel: 'sms' }).success
    ).toBe(false);
    expect(notificationCreateSchema.safeParse({ type: 'x' }).success).toBe(false);
    expect(NOTIFICATION_CHANNELS).toEqual(['in_app', 'email']);
  });

  it('validates preference payloads', () => {
    expect(
      notificationPreferenceUpdateSchema.safeParse({ channels: { in_app: false } }).success
    ).toBe(true);
    expect(notificationPreferenceUpdateSchema.safeParse({ mutedTypes: ['workflow'] }).success).toBe(
      true
    );
    expect(
      notificationPreferenceUpdateSchema.safeParse({ channels: { in_app: 'yes' } }).success
    ).toBe(false);
    expect(notificationPreferenceUpdateSchema.safeParse({ other: true }).success).toBe(false);
  });
});
