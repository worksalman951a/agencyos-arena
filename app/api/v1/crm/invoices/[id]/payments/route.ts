/**
 * AgencyOS CRM Invoices API - Record Payment
 *
 * POST /api/v1/crm/invoices/[id]/payments - Record a payment against an invoice
 *
 * Organization ID is resolved from the authenticated user's session,
 * never accepted from the client. Cross-org lookups return non-disclosing 404.
 */

import { NextResponse } from 'next/server';

import { recordPayment } from '@/lib/services/crm/invoice-service';
import { invoicePaymentSchema } from '@/lib/schemas/crm/invoice.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const body = await request.json();
    const parsed = invoicePaymentSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const result = await recordPayment(id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
