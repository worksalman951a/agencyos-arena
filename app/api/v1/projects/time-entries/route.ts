/**
 * AgencyOS Projects API - Time Entries
 *
 * GET    /api/v1/projects/time-entries?taskId=&projectId=&userId=&billable=&from=&to= - List time entries
 * POST   /api/v1/projects/time-entries                                                - Create a time entry
 */

import { NextResponse } from 'next/server';

import { listTimeEntries, createTimeEntry } from '@/lib/services/projects/time-entry-service';
import {
  timeEntryCreateSchema,
  timeEntryQuerySchema,
} from '@/lib/schemas/projects/time-entry.schema';
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

    const data = await listTimeEntries(parsed.data.taskId, parsed.data.projectId, billable, {
      userId: parsed.data.userId,
      from: parsed.data.from,
      to: parsed.data.to,
    });
    return NextResponse.json(data);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const parsed = timeEntryCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const timeEntry = await createTimeEntry(parsed.data);
    return NextResponse.json(timeEntry, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
