/**
 * AgencyOS Notification Preferences API
 *
 * GET /api/v1/automation/preferences[?userId=] - Read preferences
 * PUT /api/v1/automation/preferences              - Update own preferences
 */

import { NextResponse } from 'next/server';

import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/services/automation/notification-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || undefined;
    return NextResponse.json(await getNotificationPreferences(userId));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  try {
    return NextResponse.json(await updateNotificationPreferences(await request.json()));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    const body: Record<string, unknown> = { error: message };
    const issues = (err as { issues?: unknown }).issues;
    if (issues) body.issues = issues;
    return NextResponse.json(body, { status });
  }
}
