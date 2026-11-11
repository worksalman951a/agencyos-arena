/**
 * GET /api/v1/portal/approvals - the signed-in client's approval requests.
 */

import { NextResponse } from 'next/server';

import { listClientApprovals } from '@/lib/services/portal/client-approval-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    const approvals = await listClientApprovals();
    return NextResponse.json({ data: approvals });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
