/**
 * AgencyOS Estimate Detail page — historical record, read-only.
 *
 * Estimates are no longer part of the active sales workflow. This page exists so
 * an estimate that was issued before the retirement stays readable (and its PDF
 * / share link stays available); it offers no mutation, no conversion and no
 * navigation into any workflow.
 *
 * Reading is authorized by `getEstimate` (session → `estimate.read` → row
 * resolved with `id + organizationId`), exactly as before the retirement.
 */

import { getEstimate } from '@/lib/services/crm/estimate-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';
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
      <EstimateDetailClient estimate={estimate} clientName={clientName} />
    </div>
  );
}
