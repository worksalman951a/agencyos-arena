/**
 * AgencyOS Automation Notification API - Single Notification
 *
 * GET /api/v1/automation/notifications/[id] - Read one notification (own, or admin)
 */

import { NextResponse } from 'next/server';

import { getNotification } from '@/lib/services/automation/notification-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getNotification(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
