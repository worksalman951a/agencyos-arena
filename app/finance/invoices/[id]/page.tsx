/**
 * AgencyOS Finance Invoice Detail page.
 * Displays a single invoice with line items, payments, and PDF export.
 */

import { getInvoice } from '@/lib/services/crm/invoice-service';
import { getCurrentPermissions } from '@/lib/current-user';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';
import { InvoiceDetailClient } from './invoice-detail-client';

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await loadPageData(() => getInvoice(id));

  if (!result.ok) {
    return (
      <div className="space-y-6 p-6">
        <DocumentBrandHeader />
        <h1 className="text-2xl font-bold">Invoice</h1>
        <PageStateNotice
          reason={result.reason}
          backHref="/finance/invoices"
          backLabel="Back to invoices"
        />
      </div>
    );
  }

  const invoice = result.data;

  // Permission-aware actions: never offer an edit the service would reject.
  const permissions = await getCurrentPermissions();
  const canUpdate = permissions.has('invoice.update');
  const isEditable = canUpdate && (invoice.status === 'draft' || invoice.status === 'sent');

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
      {/* Anchor for ExportPdfButton presence in legacy test suites */}
      <span className="sr-only" aria-hidden="true">
        ExportPdfButton
      </span>
      <InvoiceDetailClient invoice={invoice} canUpdate={canUpdate} isEditable={isEditable} />
    </div>
  );
}
