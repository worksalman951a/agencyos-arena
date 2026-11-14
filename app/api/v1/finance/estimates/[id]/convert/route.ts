/**
 * AgencyOS Finance Estimate Convert API - RETIRED
 *
 * POST /api/v1/finance/estimates/[id]/convert - 403, read-only
 *
 * Converting an estimate into an invoice is no longer possible. The route is
 * kept (rather than deleted) so an old client, bookmark or integration gets an
 * explicit, coded refusal instead of a bare 404, and so the retirement is
 * visible in one place.
 *
 * The refusal is unconditional: no session lookup, no permission check, no
 * database read and no transaction. It therefore cannot leak which estimate ids
 * exist, and it cannot create, update or audit-write anything.
 *
 * Replacement workflow:
 *   POST /api/v1/crm/quotations/[id]/invoice   (default path)
 *   POST /api/v1/crm/quotations/[id]/agreement (optional agreement first)
 */

import { NextResponse } from 'next/server';

import { estimateRetiredBody } from '@/lib/sales/estimate-retirement';

export async function POST() {
  return NextResponse.json(estimateRetiredBody('convert'), { status: 403 });
}
