/**
 * AgencyOS Sales Workflow API - Quotation → Invoice
 *
 * POST /api/v1/crm/quotations/[id]/invoice
 *
 * The default path of the approved sales workflow. Creates a draft invoice from
 * an accepted quotation: the client, line items, unit prices, tax rates,
 * currency and notes are copied from the quotation, the totals are recalculated
 * server-side, and the invoice keeps `quotationId` as its source link.
 *
 * No proposal or agreement is required. A quotation may produce several
 * invoices (for example one per milestone).
 *
 * Organization ID is resolved from the authenticated user's session, never
 * accepted from the client. Cross-org or missing quotations answer the same
 * non-disclosing 404.
 */

import { NextResponse } from 'next/server';

import { createInvoiceFromQuotation } from '@/lib/services/crm/invoice-service';
import { quotationInvoiceCreateSchema } from '@/lib/schemas/crm/quotation.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // The body is optional: the source quotation already carries everything
    // the invoice needs. A present but malformed body is still a client error.
    let raw: unknown = {};
    const text = await request.text();
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        return errorResponse('Invalid JSON body', 400);
      }
    }

    const parsed = quotationInvoiceCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const invoice = await createInvoiceFromQuotation(id, parsed.data);
    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
