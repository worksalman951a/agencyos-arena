/**
 * AgencyOS Finance Estimate Convert API
 *
 * POST /api/v1/finance/estimates/[id]/convert - Convert estimate to invoice
 */

import { NextResponse } from 'next/server';

import { convertEstimateToInvoice } from '@/lib/services/crm/estimate-service';
import { estimateConvertSchema } from '@/lib/schemas/crm/estimate.schema';
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
    const parsed = estimateConvertSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const result = await convertEstimateToInvoice(id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
