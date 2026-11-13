/**
 * AgencyOS Finance API - Estimate PDF Download
 *
 * GET /api/v1/finance/estimates/[id]/pdf - Download authoritative server-rendered PDF for an estimate
 */

import { NextResponse } from 'next/server';
import { getEstimate } from '@/lib/services/crm/estimate-service';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';
import { generateEstimatePdf } from '@/lib/services/documents/pdf-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const estimate = await getEstimate(id);

    // Branding for the document header. The organization id comes from the
    // record the caller was already authorized to read (getEstimate enforces the
    // session, the permission check and organization scoping), and
    // getBrandingForOrganization takes exactly that id, so a document can never
    // be rendered with another tenant's branding.
    const brand = await getBrandingForOrganization(estimate.organizationId);
    const branding: {
      brandName?: string | null;
      brandColor?: string | null;
      logoUrl?: string | null;
    } = {
      brandName: brand.brandName,
      brandColor: brand.brandColor,
      logoUrl: brand.logoUrl,
    };

    const pdfBytes = generateEstimatePdf(estimate, branding);
    const safeDocNumber = estimate.number ? estimate.number.replace(/[^a-zA-Z0-9_-]/g, '_') : id;
    const filename = `Estimate_${safeDocNumber}.pdf`;

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
