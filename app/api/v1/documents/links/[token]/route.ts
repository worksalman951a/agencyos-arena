/**
 * AgencyOS Documents API - Verify Shareable Link
 *
 * GET    /api/v1/documents/links/[token] - Verify and access a shared document link
 */

import { NextResponse } from 'next/server';

import { verifyDocumentLink } from '@/lib/services/documents/link-service';

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Public endpoint: the token is the credential, so each failure mode gets an
 * honest message instead of a blanket "Forbidden" (an exhausted link used to
 * read as a permission problem, and an expired one as "Forbidden" with a 410).
 */
const FAILURE_MESSAGES: Record<number, string> = {
  404: 'Link not found',
  410: 'Link expired',
  403: 'Link access limit reached',
};

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const data = await verifyDocumentLink(token);
    return NextResponse.json(data);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    const status =
      statusCode === 404 || statusCode === 410 || statusCode === 403 ? statusCode : 500;
    return errorResponse(FAILURE_MESSAGES[status] ?? 'Could not resolve the link', status);
  }
}
