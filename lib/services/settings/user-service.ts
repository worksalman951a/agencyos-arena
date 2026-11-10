'use server';

import { prisma } from '@/lib/db';
import { requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import type { UserProfileUpdate } from '@/lib/schemas/settings/user.schema';

/** User profile settings shape */
export interface UserSettings {
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
  locale?: string;
}

/** Serialized user profile */
export interface UserProfileResponse {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  status: string;
  organizationId: string | null;
  settings: UserSettings;
}

/** Validate session and resolve authorized user context */
async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    const error = new Error('Unauthenticated') as Error & {
      statusCode?: number;
    };
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

/** Get user profile for the current user */
export async function getUserProfile() {
  const { userId } = await getAuthorizedUser();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      status: true,
      organizationId: true,
    },
  });

  if (!user) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
    status: user.status,
    organizationId: user.organizationId,
    settings: {},
  };
}

/**
 * Update user profile (own profile only).
 *
 * An explicit `null` clears the value; `undefined` leaves it untouched. The
 * email, role and status are never writable here.
 */
export async function updateUserProfile(input: UserProfileUpdate) {
  const { userId } = await getAuthorizedUser();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, image: true },
  });

  if (!user) {
    const error = new Error('Not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.displayName !== undefined ? { name: input.displayName } : {}),
      ...(input.avatarUrl !== undefined ? { image: input.avatarUrl } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      status: true,
      organizationId: true,
    },
  });

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    image: updated.image,
    role: updated.role,
    status: updated.status,
    organizationId: updated.organizationId,
    settings: {},
  };
}
