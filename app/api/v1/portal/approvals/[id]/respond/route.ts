/**
 * POST /api/v1/portal/approvals/:id/respond - approve or request changes.
 *
 * The responding identity and timestamp come from the session; they are never
 * accepted from the payload.
 */

import { NextResponse } from 'next/server';

import { respondToClientApproval } from '@/lib/services/portal/client-approval-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const approval = await respondToClientApproval(id, body);
    return NextResponse.json(approval);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
