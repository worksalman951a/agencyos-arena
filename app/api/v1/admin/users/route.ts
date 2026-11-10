/**
 * AgencyOS Admin User API
 *
 * GET /api/v1/admin/users - List organization members
 */

import { NextResponse } from 'next/server';

import { listUsers } from '@/lib/services/admin/user-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    return NextResponse.json(await listUsers());
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
