/**
 * GET /api/v1/settings/branding
 *
 * Organization branding for the signed-in member — used by printable documents
 * (invoice PDF) that fetch their own data. Organization id comes from the
 * session, never the query string. Only presentation values are returned.
 */

import { NextResponse } from 'next/server';

import { getBranding } from '@/lib/services/settings/branding-service';

export async function GET() {
  try {
    const branding = await getBranding();
    if (!branding) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    return NextResponse.json({
      brandName: branding.brandName,
      organizationName: branding.organizationName,
      logoUrl: branding.logoUrl,
      brandColor: branding.brandColor,
      isCustomized: branding.isCustomized,
    });
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    if (statusCode === 401) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (statusCode === 403) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Could not load branding' }, { status: 500 });
  }
}
