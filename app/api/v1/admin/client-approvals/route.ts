/**
 * GET  /api/v1/admin/client-approvals - list client approvals.
 * POST /api/v1/admin/client-approvals - request an approval from a client.
 */

import { NextResponse } from 'next/server';

import {
  createClientApprovalRequest,
  listClientApprovalsForOrganization,
} from '@/lib/services/portal/client-approval-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    const approvals = await listClientApprovalsForOrganization();
    return NextResponse.json({ data: approvals });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const approval = await createClientApprovalRequest(body);
    return NextResponse.json(approval, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
