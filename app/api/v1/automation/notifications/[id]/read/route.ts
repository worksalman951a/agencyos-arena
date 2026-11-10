/**
 * AgencyOS Automation Notification Read API
 *
 * POST /api/v1/automation/notifications/[id]/read - Mark a notification as read (idempotent)
 */

import { NextResponse } from 'next/server';

import { markNotificationRead } from '@/lib/services/automation/notification-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await markNotificationRead(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
