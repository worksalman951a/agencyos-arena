/**
 * AgencyOS Projects API - Project Files
 *
 * GET    /api/v1/projects/files?projectId= - List files for a project
 * POST   /api/v1/projects/files            - Upload a file (multipart/form-data) or link an existing asset (JSON)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  listProjectFiles,
  createProjectFile,
  uploadProjectFile,
} from '@/lib/services/projects/project-file-service';
import { projectFileCreateSchema } from '@/lib/schemas/projects/project-file.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

const cuidSchema = z.string().cuid();

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return errorResponse('projectId is required', 400);
    }

    const data = await listProjectFiles(projectId);
    return NextResponse.json(data);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
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
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const parsed = projectFileCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const file = await createProjectFile(parsed.data);
    return NextResponse.json(file, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
