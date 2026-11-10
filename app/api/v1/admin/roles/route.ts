/**
 * AgencyOS Admin Role API
 *
 * GET  /api/v1/admin/roles[?type=permissions] - List roles or the permission catalogue
 * POST /api/v1/admin/roles - Create a custom role
 */

import { NextResponse } from 'next/server';

import { createRole, listPermissions, listRoles } from '@/lib/services/admin/role-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('type') === 'permissions') {
      return NextResponse.json(await listPermissions());
    }
    return NextResponse.json(await listRoles());
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createRole(await request.json()), { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    const body: Record<string, unknown> = { error: message };
    const issues = (err as { issues?: unknown }).issues;
    if (issues) body.issues = issues;
    return NextResponse.json(body, { status });
  }
}
