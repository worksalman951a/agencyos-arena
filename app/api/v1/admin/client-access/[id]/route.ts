/**
 * PATCH /api/v1/admin/client-access/:id - update capability flags or suspend.
 *
 * The payload is validated strictly, so `organizationId`, `userId` or `role`
 * cannot be smuggled in; capabilities are the only levers.
 */

import { NextResponse } from 'next/server';

import { updateClientAccess } from '@/lib/services/portal/client-access-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const updated = await updateClientAccess(id, body);
    return NextResponse.json(updated);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
