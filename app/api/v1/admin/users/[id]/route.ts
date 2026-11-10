/**
 * AgencyOS Admin User API - Single Member
 *
 * GET    /api/v1/admin/users/[id] - Read a member
 * PATCH  /api/v1/admin/users/[id] - Update role/status (validated, audited)
 * DELETE /api/v1/admin/users/[id] - Remove the member from the organization
 */

import { NextResponse } from 'next/server';

import { getUser, removeMember, updateUser } from '@/lib/services/admin/user-service';
import { apiErrorFrom } from '@/lib/api/route-error';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await getUser(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await updateUser(id, await request.json()));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    const body: Record<string, unknown> = { error: message };
    const issues = (err as { issues?: unknown }).issues;
    if (issues) body.issues = issues;
    return NextResponse.json(body, { status });
  }
}

/** PUT stays as an alias of PATCH: the previous client posted `{ id, role, status }`. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const payload = (await request.json()) as { roleId?: string; status?: string };
    return NextResponse.json(await updateUser(id, payload));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await removeMember(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
