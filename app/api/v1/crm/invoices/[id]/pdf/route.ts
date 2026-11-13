/**
 * AgencyOS CRM API - Invoice PDF Download
 *
 * GET /api/v1/crm/invoices/[id]/pdf - Download authoritative server-rendered PDF for an invoice
 */

import { NextResponse } from 'next/server';
import { getInvoice } from '@/lib/services/crm/invoice-service';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';
import { generateInvoicePdf } from '@/lib/services/documents/pdf-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const invoice = await getInvoice(id);

    // Branding for the document header. The organization id comes from the
    // record the caller was already authorized to read (getInvoice enforces the
    // session, the permission check and organization scoping), and
    // getBrandingForOrganization takes exactly that id, so a document can never
    // be rendered with another tenant's branding.
    const brand = await getBrandingForOrganization(invoice.organizationId);
    const branding: {
      brandName?: string | null;
      brandColor?: string | null;
      logoUrl?: string | null;
    } = {
      brandName: brand.brandName,
      brandColor: brand.brandColor,
      logoUrl: brand.logoUrl,
    };

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
