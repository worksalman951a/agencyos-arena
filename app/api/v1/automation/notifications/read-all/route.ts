/**
 * AgencyOS Automation Notifications API - Mark all read
 *
 * POST /api/v1/automation/notifications/read-all - Mark every unread own notification read
 */

import { NextResponse } from 'next/server';

import { markAllNotificationsRead } from '@/lib/services/automation/notification-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function POST() {
  try {
    return NextResponse.json(await markAllNotificationsRead());
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
