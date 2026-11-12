import { getClientPortalInvoice } from '@/lib/services/portal/portal-data-service';
import { generateInvoicePdf } from '@/lib/services/documents/pdf-service';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';
import { getClientPortalSession } from '@/lib/services/portal/portal-auth-service';

import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';

export async function generateClientPortalInvoicePdf(invoiceId: string) {
  const session = await getClientPortalSession();
  const invoice = await getClientPortalInvoice(invoiceId);
  const branding = await getBrandingForOrganization(session.organizationId);

  const payload: InvoiceResponse = {
    id: invoice.id,
    organizationId: session.organizationId,
    clientId: session.contactId,
    number: invoice.number,
    title: invoice.title,
    status: invoice.status,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    createdAt: invoice.createdAt,
    updatedAt: invoice.createdAt,
    notes: null,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    creator: null,
    updater: null,
    payments: [],
    client: {
      id: session.contactId,
      firstName: session.contactName,
      lastName: '',
    },
    items: invoice.items.map((it) => ({
      id: it.id,
      invoiceId: invoice.id,
      description: it.description,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      amount: it.amount,
      taxRate: '0.00',
      createdAt: invoice.createdAt,
    })),
  };

  const pdfBuffer = await generateInvoicePdf(payload, {
    brandName: branding.brandName,
    brandColor: branding.brandColor,
    logoUrl: branding.logoUrl,
  });

  return {
    pdfBuffer,
    number: invoice.number,
  };
}
