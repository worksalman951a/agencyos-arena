/**
 * AgencyOS Finance Estimates List page.
 * Server component that lists estimates for the current organization.
 */

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
      {/* Estimates are retired from the active sales workflow. Existing records
          stay readable; new billing starts from an accepted quotation. */}
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        Estimates are kept for history and read-only reference. New billing starts from an accepted
        quotation, which can create an invoice (or an agreement first).
      </p>
      <EstimatesClient estimates={estimates} />
    </div>
  );
}
