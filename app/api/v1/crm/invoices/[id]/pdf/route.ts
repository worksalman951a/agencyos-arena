/**
 * AgencyOS CRM API - Invoice PDF Download
 *
 * GET /api/v1/crm/invoices/[id]/pdf - Download authoritative server-rendered PDF for an invoice
 */

import { NextResponse } from 'next/server';
import { getInvoice } from '@/lib/services/crm/invoice-service';
import { generateInvoicePdf } from '@/lib/services/documents/pdf-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const invoice = await getInvoice(id);

    const branding = await getBrandingForOrganization(invoice.organizationId).catch(
      () => undefined
    );

    const pdfBytes = generateInvoicePdf(invoice, branding);
    const safeDocNumber = invoice.number ? invoice.number.replace(/[^a-zA-Z0-9_-]/g, '_') : id;
    const filename = `Invoice_${safeDocNumber}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBytes.byteLength),
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
