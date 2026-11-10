/**
 * AgencyOS Automation Notifications API
 *
 * GET  /api/v1/automation/notifications[?userId=] - List notifications
 * POST /api/v1/automation/notifications - Create a notification (admin capability)
 */

import { NextResponse } from 'next/server';

import {
  createNotification,
  listNotifications,
} from '@/lib/services/automation/notification-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || undefined;
    return NextResponse.json(await listNotifications(userId));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createNotification(await request.json()), { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    const body: Record<string, unknown> = { error: message };
    const issues = (err as { issues?: unknown }).issues;
    if (issues) body.issues = issues;
    return NextResponse.json(body, { status });
  }
}
