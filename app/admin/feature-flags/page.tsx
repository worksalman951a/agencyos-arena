/**
 * AgencyOS Feature Flags page.
 * Manage feature toggles for gradual rollout and testing.
 *
 * Bifurcated under useBentoShell().
 */

import { listFeatureFlags } from '@/lib/services/admin/feature-flag-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { FeatureFlagsClient } from './feature-flags-client';

export default async function FeatureFlagsPage() {
  const result = await loadPageData(() => listFeatureFlags());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const flags = result.data as Array<{
    id: string;
    flagKey: string;
    description: string | null;
    enabled: boolean;
    createdAt: Date;
  }>;

  return <FeatureFlagsClient flags={flags} />;
}
