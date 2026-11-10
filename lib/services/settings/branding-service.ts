/**
 * White-label branding resolution (server side).
 *
 * One place resolves how the signed-in user's organization should be branded:
 *
 *   Brand Name → organization name → "AgencyOS"
 *   Brand Color → WCAG-checked accent tokens for light and dark themes
 *   Logo URL   → validated absolute http(s) URL, or null
 *
 * The result is request-cached, so the shell, the settings page and any document
 * surface in the same render share one pair of queries.
 */

import { cache } from 'react';

import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth-server';
import { requireOrganization } from '@/lib/permissions';
import {
  brandThemeCss,
  normalizeBrandColor,
  normalizeLogoUrl,
  resolveBrandName,
  resolveBrandTheme,
  type BrandTheme,
} from '@/lib/branding';
import { normalizeOrganizationSettings } from '@/lib/schemas/settings/organization.schema';

export interface BrandContext {
  /** Name shown on customer-facing surfaces. */
  brandName: string;
  /** Registered organization name, for "powered by" style hints. */
  organizationName: string;
  logoUrl: string | null;
  /** Stored brand colour, or null when the organization has none. */
  brandColor: string | null;
  theme: BrandTheme;
  /** CSS overriding accent/primary/ring tokens for `:root` and `.dark`. */
  themeCss: string;
  /** True when a custom brand colour is configured. */
  isCustomized: boolean;
}

/** Resolve branding for an organization id the caller has already authorized. */
export async function getBrandingForOrganization(organizationId: string): Promise<BrandContext> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, settings: true },
  });

  const settings = normalizeOrganizationSettings(organization?.settings);
  const brandColor = normalizeBrandColor(settings.brandColor);
  const theme = resolveBrandTheme(brandColor);

  return {
    brandName: resolveBrandName(settings.brandName, organization?.name),
    organizationName: organization?.name ?? '',
    logoUrl: normalizeLogoUrl(settings.logoUrl),
    brandColor,
    theme,
    themeCss: brandThemeCss(theme),
    isCustomized: theme.custom,
  };
}

/**
 * Branding for the current request's session, or null when signed out.
 *
 * Cached per request: the shell, the sidebar header and any document header all
 * ask for the same object.
 */
export const getBranding = cache(async (): Promise<BrandContext | null> => {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({ headers: { cookie: cookieStore.toString() } });
  if (!result?.session || !result.user) return null;

  const { organizationId } = await requireOrganization(result.user.id);
  return getBrandingForOrganization(organizationId);
});
