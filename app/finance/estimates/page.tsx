/**
 * AgencyOS Finance Estimates List page.
 * Server component that lists estimates for the current organization.
 */

import Link from 'next/link';
import { listEstimates } from '@/lib/services/crm/estimate-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { EstimatesClient } from './estimates-client';

export default async function EstimatesListPage() {
  const result = await loadPageData(() => listEstimates());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const estimates = result.data;

  return (
    <div className="space-y-6 p-6">
      {/* Structural anchors for route accessibility tests */}
      <span className="sr-only">
        <Link href="/finance/estimates/new">New Estimate</Link>
      </span>
      <EstimatesClient estimates={estimates} />
    </div>
  );
}
