/**
 * GET /api/v1/portal/download/:type/:id - authorized binary download.
 *
 * `type` is limited to the two download-capable portal resource types. The
 * service requires the `downloadFiles` capability, a live grant and a stored path
 * confined to the storage root; anything else is 403/404 with no file bytes and no
 * storage-path disclosure. Content is served as an attachment with
 * `X-Content-Type-Options: nosniff` so a shared file cannot execute in the portal
 * origin.
 */

import { NextResponse } from 'next/server';

import { downloadPortalFile } from '@/lib/services/portal/portal-workspace-service';
import { apiErrorFrom } from '@/lib/api/route-error';

const DOWNLOADABLE_TYPES = new Set(['file', 'document']);

function safeHeaderName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    const { type, id } = await params;
    if (!DOWNLOADABLE_TYPES.has(type)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const file = await downloadPortalFile(type as 'file' | 'document', id);

    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': String(file.size),
        'Content-Disposition': `attachment; filename="${safeHeaderName(file.originalName)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
