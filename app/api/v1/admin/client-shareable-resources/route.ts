/**
 * GET /api/v1/admin/client-shareable-resources - resources that can be shared.
 *
 * Optional `?type=` narrows the list to one portal resource type.
 */

import { NextResponse } from 'next/server';

import { listShareableResources } from '@/lib/services/portal/client-access-service';
import { isPortalResourceType } from '@/lib/portal/resource-registry';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawType = searchParams.get('type');
    const type = rawType && isPortalResourceType(rawType) ? rawType : undefined;

    const resources = await listShareableResources(type);
    return NextResponse.json({ data: resources });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
