/**
 * GET /api/v1/portal/approvals/:id - one approval request plus its history.
 *
 * The lookup is scoped to the caller's own client access id, so an approval id
 * belonging to another client answers 404.
 */

import { NextResponse } from 'next/server';

import { getClientApproval } from '@/lib/services/portal/client-approval-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const approval = await getClientApproval(id);
    return NextResponse.json(approval);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
