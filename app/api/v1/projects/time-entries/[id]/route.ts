/**
 * AgencyOS Projects API - Single Time Entry
 *
 * GET    /api/v1/projects/time-entries/[id] - Get single time entry
 * PUT    /api/v1/projects/time-entries/[id] - Update time entry
 * DELETE /api/v1/projects/time-entries/[id] - Delete time entry
 */

import { NextResponse } from 'next/server';

import {
  getTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
} from '@/lib/services/projects/time-entry-service';
import { timeEntryUpdateSchema } from '@/lib/schemas/projects/time-entry.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entry = await getTimeEntry(id);
    return NextResponse.json(entry);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const parsed = timeEntryUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const timeEntry = await updateTimeEntry(id, parsed.data);
    return NextResponse.json(timeEntry);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteTimeEntry(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
