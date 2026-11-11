/**
 * AgencyOS Finance Estimates API
 *
 * GET    /api/v1/finance/estimates - List estimates
 * POST   /api/v1/finance/estimates - Create an estimate
 */

import { NextResponse } from 'next/server';

import { listEstimates, createEstimate } from '@/lib/services/crm/estimate-service';
import { estimateCreateSchema } from '@/lib/schemas/crm/estimate.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET() {
  try {
    const data = await listEstimates();
    return NextResponse.json(data);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = estimateCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const estimate = await createEstimate(parsed.data);
    return NextResponse.json(estimate, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
