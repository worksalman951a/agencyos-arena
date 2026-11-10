'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';

export interface FeatureFlagResponse {
  id: string;
  organizationId: string;
  flagKey: string;
  enabled: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
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

export async function listFeatureFlags() {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'feature_flag.read');

  const flags = await prisma.featureFlag.findMany({
    where: { organizationId },
    orderBy: { flagKey: 'asc' },
  });

  interface FeatureFlagRecord {
    id: string;
    organizationId: string;
    flagKey: string;
    enabled: boolean;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
  }

  return flags.map((f: FeatureFlagRecord) => ({
    id: f.id,
    organizationId: f.organizationId,
    flagKey: f.flagKey,
    enabled: f.enabled,
    description: f.description,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));
}

export async function updateFeatureFlag(
  id: string,
  input: {
    enabled?: boolean;
    description?: string;
  }
) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'feature_flag.update');

  const existing = await prisma.featureFlag.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  // `updateMany` keeps the organization predicate in the write itself: the
  // lookup above already 404s cross-organization ids, but a bare `where: { id }`
  // write would still be a latent cross-tenant hole if the check were ever
  // refactored or the row moved between reads.
  const { count } = await prisma.featureFlag.updateMany({
    where: { id, organizationId },
    data: {
      enabled: input.enabled ?? existing.enabled,
      description: input.description ?? existing.description,
    },
  });

  if (count === 0) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const flag = await prisma.featureFlag.findFirstOrThrow({ where: { id, organizationId } });

  return {
    id: flag.id,
    organizationId: flag.organizationId,
    flagKey: flag.flagKey,
    enabled: flag.enabled,
    description: flag.description,
    createdAt: flag.createdAt,
    updatedAt: flag.updatedAt,
  };
}
