/**
 * AgencyOS Automation Unread Count API
 *
 * GET /api/v1/automation/notifications/unread-count[?userId=] - Unread count
 *   (defaults to the signed-in user; another user's count needs admin rights)
 */

import { NextResponse } from 'next/server';

import { getUnreadCount } from '@/lib/services/automation/notification-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || undefined;
    return NextResponse.json(await getUnreadCount(userId));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
