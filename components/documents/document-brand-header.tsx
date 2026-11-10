/**
 * Organization brand header for customer-facing document pages.
 *
 * Server component: resolves the same branding the shell uses (request-cached)
 * and renders logo + brand name above the document title, so an invoice,
 * proposal, quotation, estimate or contract carries the agency's identity rather
 * than the product name. Renders nothing when there is no session.
 */

import { BrandMark } from '@/components/brand/brand-mark';
import { getBranding } from '@/lib/services/settings/branding-service';

export async function DocumentBrandHeader() {
  const branding = await getBranding();
  if (!branding) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <BrandMark name={branding.brandName} logoUrl={branding.logoUrl} variant="document" />
      {branding.organizationName && branding.organizationName !== branding.brandName && (
        <span className="text-xs text-muted-foreground">{branding.organizationName}</span>
      )}
    </div>
  );
}
