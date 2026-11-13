/**
 * AgencyOS Finance API - Estimate PDF Download
 *
 * GET /api/v1/finance/estimates/[id]/pdf - Download authoritative server-rendered PDF for an estimate
 */

import { NextResponse } from 'next/server';
import { getEstimate } from '@/lib/services/crm/estimate-service';
import { generateEstimatePdf } from '@/lib/services/documents/pdf-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const estimate = await getEstimate(id);

    const branding = await getBrandingForOrganization(estimate.organizationId).catch(
      () => undefined
    );

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
