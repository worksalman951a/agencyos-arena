/**
 * POST /api/v1/admin/client-approvals/:id/cancel - cancel a pending request.
 */

import { NextResponse } from 'next/server';

import { cancelClientApprovalRequest } from '@/lib/services/portal/client-approval-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cancelled = await cancelClientApprovalRequest(id);
    return NextResponse.json(cancelled);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
