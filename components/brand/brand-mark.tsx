'use client';

/**
 * Organization brand mark: logo (when configured and loadable) + brand name.
 *
 * Props-driven so it works from both client and server components. The logo is
 * decorative next to the visible brand name (`alt=""`); if the remote image
 * fails to load, the mark falls back to the name alone instead of leaving a
 * broken image icon. Sizing is fixed so an oversized logo cannot distort the
 * header.
 */

import * as React from 'react';
import { classNames } from '@/lib/utils';

export interface BrandMarkProps {
  name: string;
  logoUrl?: string | null;
  /** Header variant (sidebar) vs document variant (invoice/proposal header). */
  variant?: 'header' | 'document';
  className?: string;
}

const IMAGE_SIZE: Record<NonNullable<BrandMarkProps['variant']>, string> = {
  header: 'h-6 w-6',
  document: 'h-10 w-10',
};

const NAME_SIZE: Record<NonNullable<BrandMarkProps['variant']>, string> = {
  header: 'text-xl',
  document: 'text-lg',
};

export function BrandMark({ name, logoUrl, variant = 'header', className }: BrandMarkProps) {
  // Track *which* URL failed rather than a boolean: a newly configured logo is
  // attempted immediately, without an effect that resets state.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const showImage = Boolean(logoUrl) && failedUrl !== logoUrl;

  return (
    <span className={classNames('flex min-w-0 items-center gap-2', className)}>
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element -- customer logos are arbitrary remote hosts; next/image would need a per-org remotePatterns allowlist
        <img
          src={logoUrl as string}
          alt=""
          className={classNames(IMAGE_SIZE[variant], 'shrink-0 rounded object-contain')}
          onError={() => setFailedUrl(logoUrl ?? null)}
          referrerPolicy="no-referrer"
        />
      )}
      <span
        className={classNames('truncate font-bold tracking-tight text-accent', NAME_SIZE[variant])}
        title={name}
      >
        {name}
      </span>
    </span>
  );
}
