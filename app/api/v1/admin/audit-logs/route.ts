/**
 * AgencyOS Admin Audit Log API
 *
 * GET /api/v1/admin/audit-logs?action=&entityType=&entityId=&actorId=&page=&pageSize=
 *   Organization-scoped, filterable, paginated audit trail.
 */

import { NextResponse } from 'next/server';

import { listAuditLogs } from '@/lib/services/admin/audit-log-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json(
      await listAuditLogs({
        action: searchParams.get('action') ?? undefined,
        entityType: searchParams.get('entityType') ?? undefined,
        entityId: searchParams.get('entityId') ?? undefined,
        actorId: searchParams.get('actorId') ?? undefined,
        page: searchParams.get('page') ?? undefined,
        pageSize: searchParams.get('pageSize') ?? undefined,
      })
    );
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
