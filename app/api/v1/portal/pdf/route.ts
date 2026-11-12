import { NextResponse } from 'next/server';
import { generateClientPortalInvoicePdf } from '@/lib/services/portal/portal-pdf-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const id = searchParams.get('id');

    if (!type || !id) {
      return NextResponse.json({ error: 'Missing type or id parameter' }, { status: 400 });
    }

    if (type !== 'invoice') {
      return NextResponse.json({ error: 'Unsupported PDF document type' }, { status: 400 });
    }

    const { pdfBuffer, number } = await generateClientPortalInvoicePdf(id);

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${number}.pdf"`,
      },
    });
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode || 500;
    return NextResponse.json({ error: err.message || 'Failed to generate PDF' }, { status });
  }
}
