/**
 * AgencyOS Projects API - Multipart File Upload
 *
 * POST /api/v1/projects/files/upload
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { uploadProjectFile } from '@/lib/services/projects/project-file-service';
import { apiErrorFrom } from '@/lib/api/route-error';

const cuidSchema = z.string().cuid();

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const rawProjectId = String(formData.get('projectId') ?? '').trim();
    const rawTaskId = String(formData.get('taskId') ?? '').trim();
    const fileEntry = formData.get('file');

    const parsedProject = cuidSchema.safeParse(rawProjectId);
    if (!parsedProject.success) {
      return errorResponse('Valid projectId is required', 400);
    }

    let taskId: string | undefined;
    if (rawTaskId) {
      const parsedTask = cuidSchema.safeParse(rawTaskId);
      if (!parsedTask.success) {
        return errorResponse('Invalid taskId', 400);
      }
      taskId = parsedTask.data;
    }

    if (!(fileEntry instanceof File)) {
      return errorResponse('A file is required', 400);
    }

    const uploaded = await uploadProjectFile({
      projectId: parsedProject.data,
      taskId,
      file: fileEntry,
    });
    return NextResponse.json(uploaded, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
