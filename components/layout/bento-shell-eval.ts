import { prisma } from '@/lib/db';

/**
 * Server-side evaluation of the Bento shell feature flag for an organization.
 * Strictly read-only and organization-scoped.
 *
 * Phase 13B Policy:
 * - If an organization explicitly sets `bento_shell` with `enabled: false`, respect the opt-out.
 * - If the flag is not set (absent) or database is unreachable, default safely to `true` (Bento enabled).
 */
export async function isBentoShellEnabled(
  organizationId: string | undefined | null
): Promise<boolean> {
  if (!organizationId) return true;
  try {
    const flag = await prisma.featureFlag.findFirst({
      where: { organizationId, flagKey: 'bento_shell' },
      select: { enabled: true },
    });
    // Explicit opt-out: if record exists and enabled === false, return false
    if (flag !== null) {
      return flag.enabled;
    }
    // Default to Bento enabled for all existing and new organizations
    return true;
  } catch {
    // If DB is unreachable, default to Bento enabled
    return true;
  }
}
