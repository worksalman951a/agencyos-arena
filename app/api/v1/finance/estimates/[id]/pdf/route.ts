/**
 * AgencyOS Finance API - Estimate PDF Download
 *
 * GET /api/v1/finance/estimates/[id]/pdf - Download authoritative server-rendered PDF for an estimate
 */

import { NextResponse } from 'next/server';
import { getEstimate } from '@/lib/services/crm/estimate-service';
import { generateEstimatePdf } from '@/lib/services/documents/pdf-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { prisma } from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const estimate = await getEstimate(id);

    // Fetch branding info if available
    let branding: {
      brandName?: string | null;
      brandColor?: string | null;
      logoUrl?: string | null;
    } = {};
    try {
      const orgSettings = await prisma.organizationSetting.findFirst({
        where: { organizationId: estimate.organizationId },
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
