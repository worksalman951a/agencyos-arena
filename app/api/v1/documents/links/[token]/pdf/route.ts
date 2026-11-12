/**
 * AgencyOS Documents API - Public Shared Document PDF Download
 *
 * GET /api/v1/documents/links/[token]/pdf - Download authoritative server-rendered PDF for a shared document link
 */

import { NextResponse } from 'next/server';
import { verifyDocumentLink } from '@/lib/services/documents/link-service';
import { generateSharedDocumentPdf } from '@/lib/services/documents/pdf-service';

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

const FAILURE_MESSAGES: Record<number, string> = {
  404: 'Link not found',
  410: 'Link expired',
  403: 'Link access limit reached',
};

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const verified = await verifyDocumentLink(token);

    if (!verified.snapshot) {
      return errorResponse('Document snapshot not available', 404);
    }

    const pdfBytes = generateSharedDocumentPdf(verified.snapshot);
    const docTitle = (verified.documentTitle || 'Document').replace(/[^a-zA-Z0-9_-]/g, '_');
    const docRef = (verified.snapshot.number || verified.id.slice(-6)).replace(
      /[^a-zA-Z0-9_-]/g,
      '_'
    );
    const filename = `${docTitle}_${docRef}.pdf`;

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
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    const status =
      statusCode === 404 || statusCode === 410 || statusCode === 403 ? statusCode : 500;
    return errorResponse(FAILURE_MESSAGES[status] ?? 'Could not resolve the link', status);
  }
}
