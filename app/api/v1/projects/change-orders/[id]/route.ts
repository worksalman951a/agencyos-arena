/**
 * AgencyOS Projects API - Single Change Order
 *
 * GET    /api/v1/projects/change-orders/[id] - Get single change order
 * PUT    /api/v1/projects/change-orders/[id] - Update change order
 * DELETE /api/v1/projects/change-orders/[id] - Delete change order
 */

import { NextResponse } from 'next/server';

import {
  getChangeOrder,
  updateChangeOrder,
  deleteChangeOrder,
} from '@/lib/services/projects/change-order-service';
import { changeOrderUpdateSchema } from '@/lib/schemas/projects/change-order.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const changeOrder = await getChangeOrder(id);
    return NextResponse.json(changeOrder);
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

    const parsed = changeOrderUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const changeOrder = await updateChangeOrder(id, parsed.data);
    return NextResponse.json(changeOrder);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteChangeOrder(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
