'use client';

/**
 * Branding context.
 *
 * The server resolves the organization's brand once per request (name, logo,
 * colour, theme CSS) and the shared shell publishes it here, so any client
 * component — in particular printable documents — can render the same
 * organization branding without a second request.
 */

import * as React from 'react';
import type { BrandContext } from '@/lib/services/settings/branding-service';

const BrandingContext = React.createContext<BrandContext | null>(null);

export function BrandingProvider({
  branding,
  children,
}: {
  branding: BrandContext;
  children: React.ReactNode;
}) {
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

/** Organization branding for the current shell, or null outside an app page. */
export function useBranding(): BrandContext | null {
  return React.useContext(BrandingContext);
}
