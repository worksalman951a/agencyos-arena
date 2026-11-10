/**
 * AgencyOS Projects API - Authenticated File Download
 *
 * GET /api/v1/projects/files/[id]/download
 */

import { NextResponse } from 'next/server';

import { downloadProjectFile } from '@/lib/services/projects/project-file-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { buffer, originalName, mimeType, size } = await downloadProjectFile(id);
    const asciiFallback = originalName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    const encodedName = encodeURIComponent(originalName);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(size),
        'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
