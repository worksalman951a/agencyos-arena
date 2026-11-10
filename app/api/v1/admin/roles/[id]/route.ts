/**
 * AgencyOS Admin Role API - Single Role
 *
 * GET    /api/v1/admin/roles/[id] - Read a role with its permissions
 * PATCH  /api/v1/admin/roles/[id] - Update name/description/permissions (audited)
 * DELETE /api/v1/admin/roles/[id] - Delete an unassigned custom role
 */

import { NextResponse } from 'next/server';

import { deleteRole, getRole, updateRole } from '@/lib/services/admin/role-service';
import { apiErrorFrom } from '@/lib/api/route-error';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await getRole(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await updateRole(id, await request.json()));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    const body: Record<string, unknown> = { error: message };
    const issues = (err as { issues?: unknown }).issues;
    if (issues) body.issues = issues;
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await updateRole(id, await request.json()));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await deleteRole(id));
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
