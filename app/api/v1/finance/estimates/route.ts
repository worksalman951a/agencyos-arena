/**
 * AgencyOS Finance Estimates API (historical, read-only)
 *
 * GET  /api/v1/finance/estimates - List historical estimates
 * POST /api/v1/finance/estimates - RETIRED (403, read-only)
 *
 * Estimates were retired from the active sales workflow. Existing rows are
 * preserved and stay readable, but nothing may create, edit, duplicate, send,
 * change status of, delete or convert one. The collection endpoint therefore
 * keeps only its read verb; `POST` answers a coded 403 and writes nothing.
 *
 * New billing starts from an accepted quotation:
 *   POST /api/v1/crm/quotations/[id]/invoice
 *   POST /api/v1/crm/quotations/[id]/agreement
 */

import { NextResponse } from 'next/server';

import { listEstimates } from '@/lib/services/crm/estimate-service';
import { apiErrorFrom } from '@/lib/api/route-error';
import { estimateRetiredBody } from '@/lib/sales/estimate-retirement';

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

/**
 * Refuse creation. The body is not parsed and no service is called: the refusal
 * is the whole behaviour, so a malformed body cannot change the answer.
 */
export async function POST() {
  return NextResponse.json(estimateRetiredBody('create'), { status: 403 });
}
