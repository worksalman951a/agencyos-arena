/**
 * AgencyOS Documents API - Contract PDF Download
 *
 * GET /api/v1/documents/contracts/[id]/pdf - Download authoritative server-rendered PDF for a contract
 */

import { NextResponse } from 'next/server';
import { getContract } from '@/lib/services/documents/contract-service';
import { generateContractPdf } from '@/lib/services/documents/pdf-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const contract = await getContract(id);

    // Fetch branding info if available
    let branding: {
      brandName?: string | null;
      brandColor?: string | null;
      logoUrl?: string | null;
    } = {};
    try {
      const brandContext = await getBrandingForOrganization(contract.organizationId);
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

    const pdfBytes = generateContractPdf(contract, branding);
    const safeTitle = (contract.title || id).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Contract_${safeTitle.slice(0, 30)}_${id.slice(-6)}.pdf`;

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
