/**
 * AgencyOS Finance Estimate API - Single historical estimate
 *
 * GET    /api/v1/finance/estimates/[id] - Get estimate by ID (read-only)
 * PUT    /api/v1/finance/estimates/[id] - RETIRED (403, read-only)
 * PATCH  /api/v1/finance/estimates/[id] - RETIRED (403, read-only)
 * DELETE /api/v1/finance/estimates/[id] - RETIRED (403, read-only)
 *
 * Editing (including status changes such as "mark as sent", "accept", "reject",
 * "expire", and duplication) and deletion were removed with the retirement.
 * The 403 is unconditional and identical for every caller, so it cannot be used
 * to probe which estimate ids exist.
 */

import { NextResponse } from 'next/server';

import { getEstimate } from '@/lib/services/crm/estimate-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { estimateRetiredBody } from '@/lib/sales/estimate-retirement';

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

/** Refuse an edit / status change (including "send"). */
export async function PUT() {
  return NextResponse.json(estimateRetiredBody('edit'), { status: 403 });
}

/** Same refusal for PATCH, so the method cannot be used to bypass PUT. */
export async function PATCH() {
  return NextResponse.json(estimateRetiredBody('edit'), { status: 403 });
}

/** Refuse deletion: historical estimates are preserved. */
export async function DELETE() {
  return NextResponse.json(estimateRetiredBody('delete'), { status: 403 });
}
