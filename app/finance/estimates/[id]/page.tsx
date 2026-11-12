/**
 * AgencyOS Estimate Detail page.
 * Displays a single estimate with client relationship, status lifecycle actions,
 * PDF export, shareable link, and convert-to-invoice action.
 */

import { getEstimate } from '@/lib/services/crm/estimate-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';
import { EstimateActions } from './EstimateActions';
import { EstimateDetailClient } from './estimate-detail-client';

export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => getEstimate(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref="/finance/estimates"
        backLabel="Back to estimates"
      />
    );
  }

  const estimate = result.data;
  const clientName = estimate.client
    ? `${estimate.client.firstName ?? ''} ${estimate.client.lastName ?? ''}`.trim() ||
      estimate.client.email ||
      'Unnamed Contact'
    : null;

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
      <EstimateDetailClient
        estimate={estimate}
        clientName={clientName}
        actionsNode={<EstimateActions estimateId={estimate.id} status={estimate.status} />}
      />
    </div>
  );
}
