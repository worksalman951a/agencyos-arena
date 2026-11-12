import { prisma } from '@/lib/db';

/**
 * Server-side evaluation of the Bento shell feature flag for an organization.
 * Strictly read-only, organization-scoped, and defaults safely to false on any error.
 */
export async function isBentoShellEnabled(
  organizationId: string | undefined | null
): Promise<boolean> {
  if (!organizationId) return false;
  try {
    const flag = await prisma.featureFlag.findFirst({
      where: { organizationId, flagKey: 'bento_shell' },
      select: { enabled: true },
    });
    return flag?.enabled ?? false;
  } catch {
    // If DB is unreachable or flag not seeded, default safely to legacy shell
    return false;
  }
}
