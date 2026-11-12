/**
 * AgencyOS CRM API - Invoice PDF Download
 *
 * GET /api/v1/crm/invoices/[id]/pdf - Download authoritative server-rendered PDF for an invoice
 */

import { NextResponse } from 'next/server';
import { getInvoice } from '@/lib/services/crm/invoice-service';
import { generateInvoicePdf } from '@/lib/services/documents/pdf-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { prisma } from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const invoice = await getInvoice(id);

    // Fetch branding info if available
    let branding: {
      brandName?: string | null;
      brandColor?: string | null;
      logoUrl?: string | null;
    } = {};
    try {
      const orgSettings = await prisma.organizationSetting.findFirst({
        where: { organizationId: invoice.organizationId },
      });
      if (orgSettings) {
        branding = {
          brandName: orgSettings.brandName,
          brandColor: orgSettings.brandColor,
          logoUrl: orgSettings.logoUrl,
        };
      }
    } catch {
      // Graceful fallback to default branding
    }

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
