import { getQuotation } from '@/lib/services/crm/quotation-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DocumentBrandHeader } from '@/components/documents/document-brand-header';
import { QuotationDetailClient } from './quotation-detail-client';

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => getQuotation(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref="/sales/quotations"
        backLabel="Back to quotations"
      />
    );
  }

  const quotation = result.data;

  const formattedQuotation = {
    id: quotation.id,
    organizationId: quotation.organizationId,
    number: quotation.number,
    title: quotation.title,
    status: quotation.status,
    subtotal: Number(quotation.subtotal),
    tax: Number(quotation.tax),
    total: Number(quotation.total),
    currency: quotation.currency,
    validUntil: quotation.validUntil,
    notes: quotation.notes,
    opportunityId: quotation.opportunityId,
    contactId: quotation.contactId,
    opportunity: quotation.opportunity,
    contact: quotation.contact,
    creator: quotation.creator,
    updater: quotation.updater,
    items: quotation.items.map((it) => ({
      id: it.id,
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      taxRate: Number(it.taxRate),
      amount: Number(it.amount),
      sortOrder: it.sortOrder,
    })),
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
  };

  return (
    <div className="space-y-6 p-6">
      <DocumentBrandHeader />
      <QuotationDetailClient quotation={formattedQuotation} />
    </div>
  );
}
