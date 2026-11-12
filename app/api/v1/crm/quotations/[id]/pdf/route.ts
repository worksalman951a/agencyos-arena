/**
 * AgencyOS CRM API - Quotation PDF Download
 *
 * GET /api/v1/crm/quotations/[id]/pdf - Download authoritative server-rendered PDF for a quotation
 */

import { NextResponse } from 'next/server';
import { getQuotation } from '@/lib/services/crm/quotation-service';
import { generateQuotationPdf } from '@/lib/services/documents/pdf-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const quotation = await getQuotation(id);

    // Fetch branding info if available
    let branding: {
      brandName?: string | null;
      brandColor?: string | null;
      logoUrl?: string | null;
    } = {};
    try {
      const brandContext = await getBrandingForOrganization(quotation.organizationId);
      if (brandContext) {
        branding = {
          brandName: brandContext.brandName,
          brandColor: brandContext.brandColor,
          logoUrl: brandContext.logoUrl,
        };
      }
    } catch {
      // Graceful fallback to default branding
    }

    const pdfBytes = generateQuotationPdf(quotation, branding);
    const safeDocNumber = quotation.number ? quotation.number.replace(/[^a-zA-Z0-9_-]/g, '_') : id;
    const filename = `Quotation_${safeDocNumber}.pdf`;

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
