/**
 * AgencyOS Sales Workflow API - Quotation → Agreement
 *
 * POST /api/v1/crm/quotations/[id]/agreement
 *
 * The optional middle step of the approved workflow (Quotation → Agreement →
 * Invoice). Creates a draft agreement (contract) whose title defaults to the
 * quotation's title and whose `quotationId` preserves the source link.
 *
 * An agreement does not carry line items in this schema, so pricing stays on
 * the quotation and is copied to the invoice when one is created from the same
 * quotation. Creating a second agreement for a quotation returns the existing
 * non-voided agreement instead of duplicating it.
 *
 * Organization ID is resolved from the authenticated user's session, never
 * accepted from the client. Cross-org or missing quotations answer the same
 * non-disclosing 404.
 */

import { NextResponse } from 'next/server';

import { createAgreementFromQuotation } from '@/lib/services/documents/contract-service';
import { quotationAgreementCreateSchema } from '@/lib/schemas/crm/quotation.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    let raw: unknown = {};
    const text = await request.text();
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        return errorResponse('Invalid JSON body', 400);
      }
    }

    const parsed = quotationAgreementCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const agreement = await createAgreementFromQuotation(id, parsed.data);
    return NextResponse.json(agreement, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
