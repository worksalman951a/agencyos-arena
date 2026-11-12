/**
 * AgencyOS CRM API - Proposal PDF Download
 *
 * GET /api/v1/crm/proposals/[id]/pdf - Download authoritative server-rendered PDF for a proposal
 */

import { NextResponse } from 'next/server';
import { getProposal } from '@/lib/services/crm/proposal-service';
import { generateProposalPdf } from '@/lib/services/documents/pdf-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const proposal = await getProposal(id);

    // Fetch branding info if available
    let branding: {
      brandName?: string | null;
      brandColor?: string | null;
      logoUrl?: string | null;
    } = {};
    try {
      const brandContext = await getBrandingForOrganization(proposal.organizationId);
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

    const pdfBytes = generateProposalPdf(proposal, branding);
    const safeDocNumber = proposal.number ? proposal.number.replace(/[^a-zA-Z0-9_-]/g, '_') : id;
    const filename = `Proposal_${safeDocNumber}.pdf`;

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
