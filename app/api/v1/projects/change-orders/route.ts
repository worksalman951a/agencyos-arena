/**
 * AgencyOS Projects API - Change Orders
 *
 * GET    /api/v1/projects/change-orders?projectId= - List change orders for a project
 * POST   /api/v1/projects/change-orders - Create a change order
 */

import { NextResponse } from 'next/server';

import { listChangeOrders, createChangeOrder } from '@/lib/services/projects/change-order-service';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Optional: filter by one project, or list the organization's change orders.
    const projectId = searchParams.get('projectId') || undefined;

    const data = await listChangeOrders(projectId);
    return NextResponse.json(data);
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    return errorResponse(
      statusCode === 401 ? 'Unauthenticated' : statusCode === 403 ? 'Forbidden' : 'Not found',
      statusCode
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const changeOrder = await createChangeOrder(body);
    return NextResponse.json(changeOrder, { status: 201 });
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    return errorResponse(
      statusCode === 401 ? 'Unauthenticated' : statusCode === 403 ? 'Forbidden' : 'Not found',
      statusCode
    );
  }
}
