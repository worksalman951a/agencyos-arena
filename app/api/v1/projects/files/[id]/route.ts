/**
 * AgencyOS Projects API - Single Project File
 *
 * DELETE /api/v1/projects/files/[id] - Delete a project file record
 */

import { NextResponse } from 'next/server';

import { deleteProjectFile } from '@/lib/services/projects/project-file-service';
import { apiErrorFrom } from '@/lib/api/route-error';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteProjectFile(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
