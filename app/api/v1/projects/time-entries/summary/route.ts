/**
 * AgencyOS Projects API - Time Entry Summary
 *
 * GET    /api/v1/projects/time-entries/summary?taskId=&projectId=&userId=&billable=&from=&to=
 */

import { NextResponse } from 'next/server';

import { getTimeEntrySummary } from '@/lib/services/projects/time-entry-service';
import { timeEntryQuerySchema } from '@/lib/schemas/projects/time-entry.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (value !== '') rawQuery[key] = value;
    }

    const parsed = timeEntryQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return errorResponse('Invalid query parameters', 400, parsed.error.issues);
    }

    const billable =
      parsed.data.billable === 'true' ? true : parsed.data.billable === 'false' ? false : undefined;

    const summary = await getTimeEntrySummary(parsed.data.taskId, parsed.data.projectId, billable, {
      userId: parsed.data.userId,
      from: parsed.data.from,
      to: parsed.data.to,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
