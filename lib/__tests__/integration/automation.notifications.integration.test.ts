/**
 * Integration: notifications — creation, targeting, read state, preferences,
 * duplicate prevention and organization scoping.
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import {
  authHeaders,
  cleanupOrganizations,
  createBootstrappedAccount,
  createMemberWithPermissions,
  createOrganizationWithAdmin,
  type TestAccount,
} from './batch4-provisioning';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const createdOrganizations: string[] = [];

async function jsonFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${process.env.TEST_SERVER_URL ?? 'http://localhost:3001'}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

describeIfDb('notifications (integration)', () => {
  let admin: TestAccount;

  beforeAll(async () => {
    admin = await createBootstrappedAccount('notifications-admin');
    createdOrganizations.push(admin.organizationId);
  });

  afterAll(async () => {
    await cleanupOrganizations(createdOrganizations);
  });

  it('creates a notification for a member and lists it for them', async () => {
    const member = await createMemberWithPermissions(admin.organizationId, 'reader', [
      'notification.read',
      'notification.update',
    ]);

    const create = await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify({
        userId: member.userId,
        type: 'task_assigned',
        channel: 'in_app',
        payload: { title: 'You have a new task' },
      }),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);

    const list = await jsonFetch('/api/v1/automation/notifications', {
      headers: authHeaders(member.token),
    });
    expect(list.status).toBe(200);
    const rows = list.body as Array<{ type: string; read: boolean; userId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(member.userId);
    expect(rows[0].read).toBe(false);
  });

  it('prevents duplicate notifications with the same dedupe key', async () => {
    const member = await createMemberWithPermissions(admin.organizationId, 'dedupe', [
      'notification.read',
      'notification.update',
    ]);
    const payload = {
      userId: member.userId,
      type: 'invoice_overdue',
      channel: 'in_app',
      dedupeKey: `invoice-overdue-${Date.now()}`,
    };

    const first = await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);

    const second = await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(201);
    expect((second.body as { duplicate?: boolean }).duplicate).toBe(true);

    const count = await prisma.notification.count({
      where: { userId: member.userId, type: 'invoice_overdue' },
    });
    expect(count).toBe(1);

    // A different key is a different notification.
    const third = await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify({ ...payload, dedupeKey: `${payload.dedupeKey}-second` }),
    });
    expect(third.status).toBe(201);
    expect(
      await prisma.notification.count({ where: { userId: member.userId, type: 'invoice_overdue' } })
    ).toBe(2);
  });

  it('tracks unread counts and read state, and is idempotent on re-read', async () => {
    const member = await createMemberWithPermissions(admin.organizationId, 'unread', [
      'notification.read',
    ]);

    for (const title of ['one', 'two']) {
      await jsonFetch('/api/v1/automation/notifications', {
        method: 'POST',
        headers: authHeaders(admin.token),
        body: JSON.stringify({ userId: member.userId, type: 'mention', payload: { title } }),
      });
    }

    const before = await jsonFetch('/api/v1/automation/notifications/unread-count', {
      headers: authHeaders(member.token),
    });
    expect(before.status).toBe(200);
    expect((before.body as { count: number }).count).toBe(2);

    const list = await jsonFetch('/api/v1/automation/notifications', {
      headers: authHeaders(member.token),
    });
    const firstId = (list.body as Array<{ id: string }>)[0].id;

    const read = await jsonFetch(`/api/v1/automation/notifications/${firstId}/read`, {
      method: 'POST',
      headers: authHeaders(member.token),
    });
    expect(read.status).toBe(200);
    expect((read.body as { read: boolean }).read).toBe(true);

    // Reading again must not fail and must not create a second audit entry.
    const again = await jsonFetch(`/api/v1/automation/notifications/${firstId}/read`, {
      method: 'POST',
      headers: authHeaders(member.token),
    });
    expect(again.status).toBe(200);
    const auditCount = await prisma.auditLog.count({
      where: { action: 'notification.read', entityId: firstId },
    });
    expect(auditCount).toBe(1);

    const after = await jsonFetch('/api/v1/automation/notifications/unread-count', {
      headers: authHeaders(member.token),
    });
    expect((after.body as { count: number }).count).toBe(1);

    const readAll = await jsonFetch('/api/v1/automation/notifications/read-all', {
      method: 'POST',
      headers: authHeaders(member.token),
    });
    expect(readAll.status).toBe(200);
    expect((readAll.body as { updated: number }).updated).toBe(1);

    const final = await jsonFetch('/api/v1/automation/notifications/unread-count', {
      headers: authHeaders(member.token),
    });
    expect((final.body as { count: number }).count).toBe(0);
  });

  it('respects notification preferences before creating anything', async () => {
    const member = await createMemberWithPermissions(admin.organizationId, 'muted', [
      'notification.read',
      'notification.preference',
    ]);

    const save = await jsonFetch('/api/v1/automation/preferences', {
      method: 'PUT',
      headers: authHeaders(member.token),
      body: JSON.stringify({ mutedTypes: ['mention'] }),
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);

    const create = await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify({ userId: member.userId, type: 'mention', payload: { title: 'muted' } }),
    });
    expect(create.status).toBe(201);
    expect((create.body as { skipped?: boolean }).skipped).toBe(true);

    expect(
      await prisma.notification.count({ where: { userId: member.userId, type: 'mention' } })
    ).toBe(0);

    // An unmuted type still arrives.
    const other = await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify({ userId: member.userId, type: 'task_assigned' }),
    });
    expect((other.body as { skipped?: boolean }).skipped).toBeUndefined();

    const prefs = await jsonFetch('/api/v1/automation/preferences', {
      headers: authHeaders(member.token),
    });
    expect((prefs.body as { mutedTypes: string[] }).mutedTypes).toEqual(['mention']);
  });

  it('rejects an unsupported preference channel', async () => {
    const member = await createMemberWithPermissions(admin.organizationId, 'bad-channel', [
      'notification.read',
      'notification.preference',
    ]);
    const res = await jsonFetch('/api/v1/automation/preferences', {
      method: 'PUT',
      headers: authHeaders(member.token),
      body: JSON.stringify({ channels: { carrier_pigeon: true } }),
    });
    expect(res.status).toBe(400);
  });

  it('keeps notifications private: a peer cannot read or target another member', async () => {
    const alice = await createMemberWithPermissions(admin.organizationId, 'alice', [
      'notification.read',
    ]);
    const bob = await createMemberWithPermissions(admin.organizationId, 'bob', [
      'notification.read',
    ]);

    await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify({ userId: alice.userId, type: 'private_note' }),
    });

    // Bob's list only contains his own notifications.
    const bobList = await jsonFetch('/api/v1/automation/notifications', {
      headers: authHeaders(bob.token),
    });
    expect(bobList.status).toBe(200);
    expect(bobList.body).toEqual([]);

    // Reading Alice's list requires admin capabilities.
    const peek = await jsonFetch(`/api/v1/automation/notifications?userId=${alice.userId}`, {
      headers: authHeaders(bob.token),
    });
    expect(peek.status).toBe(403);

    // And he cannot create a notification for her.
    const target = await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(bob.token),
      body: JSON.stringify({ userId: alice.userId, type: 'spoofed' }),
    });
    expect(target.status).toBe(403);
  });

  it('rejects a notification target from another organization', async () => {
    const foreign = await createOrganizationWithAdmin('foreign-target');
    createdOrganizations.push(foreign.organizationId);
    const res = await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify({ userId: foreign.userId, type: 'cross_org' }),
    });
    expect(res.status).toBe(404);
    expect(await prisma.notification.count({ where: { userId: foreign.userId } })).toBe(0);
  });

  it('validates the create payload', async () => {
    const res = await jsonFetch('/api/v1/automation/notifications', {
      method: 'POST',
      headers: authHeaders(admin.token),
      body: JSON.stringify({ type: 'missing_user' }),
    });
    expect(res.status).toBe(400);
  });
});
