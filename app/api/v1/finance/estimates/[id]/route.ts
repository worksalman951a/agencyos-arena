/**
 * AgencyOS Finance Estimate API - Single Estimate
 *
 * GET    /api/v1/finance/estimates/[id] - Get estimate by ID
 * PUT    /api/v1/finance/estimates/[id] - Update estimate
 * DELETE /api/v1/finance/estimates/[id] - Delete estimate
 */

import { NextResponse } from 'next/server';

import { getEstimate, updateEstimate, deleteEstimate } from '@/lib/services/crm/estimate-service';
import { estimateUpdateSchema } from '@/lib/schemas/crm/estimate.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const estimate = await getEstimate(id);
    return NextResponse.json(estimate);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = estimateUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const estimate = await updateEstimate(id, parsed.data);
    return NextResponse.json(estimate);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteEstimate(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
