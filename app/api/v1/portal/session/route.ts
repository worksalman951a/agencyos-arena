/**
 * GET /api/v1/portal/session - the resolved portal identity.
 *
 * Returns only the client-safe projection of the caller's own access (no
 * organization internals, no other client data). 401 when unauthenticated and 403
 * when the access was suspended or revoked, which is what the portal UI uses to
 * sign a client out.
 */

import { NextResponse } from 'next/server';

import { capabilityFlags, requirePortalAccess } from '@/lib/portal/access-control';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET() {
  try {
    const context = await requirePortalAccess();
    return NextResponse.json({
      userId: context.userId,
      email: context.email,
      contactName: context.contactName,
      organizationName: context.organizationName,
      role: context.role,
      status: context.status,
      capabilities: capabilityFlags(context),
    });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
