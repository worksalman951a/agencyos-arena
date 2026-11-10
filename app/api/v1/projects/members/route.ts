/**
 * AgencyOS Projects API - Organization Team Members (for task/time/approver selectors)
 *
 * GET /api/v1/projects/members
 */

import { NextResponse } from 'next/server';

import { listProjectMembers } from '@/lib/services/crm/project-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    const members = await listProjectMembers();
    return NextResponse.json({ members });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
