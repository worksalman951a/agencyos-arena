/**
 * AgencyOS Projects API - Time Entries
 *
 * GET    /api/v1/projects/time-entries?taskId=&projectId=&billable= - List time entries
 * POST   /api/v1/projects/time-entries                              - Create a time entry
 */

import { NextResponse } from 'next/server';

import { listTimeEntries, createTimeEntry } from '@/lib/services/projects/time-entry-service';
import { timeEntryCreateSchema } from '@/lib/schemas/projects/time-entry.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId') || undefined;
    const projectId = searchParams.get('projectId') || undefined;
    const billableParam = searchParams.get('billable');

    let billable: boolean | undefined;
    if (billableParam === 'true') billable = true;
    else if (billableParam === 'false') billable = false;
    else if (billableParam !== null && billableParam !== '') {
      return errorResponse('billable filter must be true or false', 400);
    }

    const data = await listTimeEntries(taskId, projectId, billable);
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
