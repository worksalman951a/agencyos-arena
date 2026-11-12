/**
 * GET  /api/v1/portal/notifications - the client's own notifications.
 * POST /api/v1/portal/notifications - mark all of them read.
 */

import { NextResponse } from 'next/server';

import {
  listPortalNotifications,
  markAllPortalNotificationsRead,
} from '@/lib/services/portal/portal-workspace-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    const notifications = await listPortalNotifications();
    return NextResponse.json({ data: notifications });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST() {
  try {
    const result = await markAllPortalNotificationsRead();
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
