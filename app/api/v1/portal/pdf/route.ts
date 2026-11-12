import { NextResponse } from 'next/server';
import {
  generateClientPortalInvoicePdf,
  generateClientPortalProposalPdf,
  generateClientPortalQuotationPdf,
  generateClientPortalContractPdf,
} from '@/lib/services/portal/portal-pdf-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const id = searchParams.get('id');

    if (!type || !id) {
      return NextResponse.json({ error: 'Missing type or id parameter' }, { status: 400 });
    }

    let pdfResult: { pdfBuffer: Uint8Array; number: string };

    if (type === 'invoice') {
      pdfResult = await generateClientPortalInvoicePdf(id);
    } else if (type === 'proposal') {
      pdfResult = await generateClientPortalProposalPdf(id);
    } else if (type === 'quotation') {
      pdfResult = await generateClientPortalQuotationPdf(id);
    } else if (type === 'contract') {
      pdfResult = await generateClientPortalContractPdf(id);
    } else {
      return NextResponse.json({ error: 'Unsupported PDF document type' }, { status: 400 });
    }

    return new NextResponse(Buffer.from(pdfResult.pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${type.toUpperCase()}-${pdfResult.number}.pdf"`,
      },
    });
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode || 500;
    return NextResponse.json({ error: err.message || 'Failed to generate PDF' }, { status });
  }
}
