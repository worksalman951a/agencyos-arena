/**
 * GET /api/v1/portal/preferences - the client's notification preferences.
 * PUT /api/v1/portal/preferences - update them (channels + muted types).
 */

import { NextResponse } from 'next/server';

import {
  getPortalNotificationPreferences,
  updatePortalNotificationPreferences,
} from '@/lib/services/portal/portal-workspace-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    const preferences = await getPortalNotificationPreferences();
    return NextResponse.json(preferences);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const preferences = await updatePortalNotificationPreferences(body);
    return NextResponse.json(preferences);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
