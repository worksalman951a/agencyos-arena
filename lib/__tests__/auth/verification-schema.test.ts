/**
 * Regression guard for a failure that only appears against a real database.
 *
 * Better Auth's adapter transform copies only declared model fields, so a
 * `Verification.userId` that is not declared is dropped before Prisma sees it
 * and every token write fails with "Argument `user` is missing".
 */

import { describe, it, expect } from 'vitest';
import { createAdapterFactory } from '@better-auth/core/db/adapter';
import { getAuthTables } from 'better-auth/db';

import { VERIFICATION_ADDITIONAL_FIELDS } from '@/lib/auth/verification-schema';

const OPTIONS = { verification: { additionalFields: VERIFICATION_ADDITIONAL_FIELDS } };

describe('Verification schema extension', () => {
  it('declares userId so the adapter does not drop it', () => {
    const tables = getAuthTables(OPTIONS);
    expect(tables.verification.fields.userId).toMatchObject({
      type: 'string',
      required: true,
    });
  });

  it('keeps userId in the payload handed to the database adapter', async () => {
    let created: Record<string, unknown> | null = null;

    const factory = createAdapterFactory({
      config: { adapterId: 'test', adapterName: 'test', usePlural: false },
      adapter: () => ({
        create: async <T extends Record<string, unknown>>({ data }: { data: T }) => {
          created = data;
          return { ...data, id: 'verification-id' };
        },
        findOne: async () => null,
        findMany: async () => [],
        delete: async () => {},
        deleteMany: async () => 0,
        update: async () => null,
        updateMany: async () => 0,
        count: async () => 0,
      }),
    });

    const adapter = factory(OPTIONS);
    await adapter.create({
      model: 'verification',
      data: {
        identifier: 'password-reset:hash',
        value: 'user-id',
        expiresAt: new Date(),
        userId: 'user-id',
      },
    });

    expect(created).toMatchObject({ userId: 'user-id', value: 'user-id' });
    expect(created).not.toHaveProperty('user');
  });
});
