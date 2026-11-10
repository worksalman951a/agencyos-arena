/**
 * AgencyOS Projects API - Change Orders
 *
 * GET    /api/v1/projects/change-orders?projectId= - List change orders
 * POST   /api/v1/projects/change-orders            - Create a change order
 */

import { NextResponse } from 'next/server';

import { listChangeOrders, createChangeOrder } from '@/lib/services/projects/change-order-service';
import { changeOrderCreateSchema } from '@/lib/schemas/projects/change-order.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || undefined;
    const data = await listChangeOrders(projectId);
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

    const parsed = changeOrderCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const changeOrder = await createChangeOrder(parsed.data);
    return NextResponse.json(changeOrder, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
