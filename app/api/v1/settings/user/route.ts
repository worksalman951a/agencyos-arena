/**
 * AgencyOS Settings API - User Profile
 *
 * GET    /api/v1/settings/user - Get current user profile
 * PUT    /api/v1/settings/user - Update current user profile
 *
 * Users can only update their own profile; the user id always comes from the
 * session. Validation lives in the shared zod schema so the UI and the API
 * agree on limits and URL rules, and failures return honest status codes.
 */

import { NextResponse } from 'next/server';

import { getUserProfile, updateUserProfile } from '@/lib/services/settings/user-service';
import { userProfileUpdateSchema } from '@/lib/schemas/settings/user.schema';

function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function handleError(err: unknown) {
  const statusCode = (err as Error & { statusCode?: number }).statusCode;
  if (statusCode === 401) return errorResponse('Unauthenticated', 401);
  if (statusCode === 403) return errorResponse('Forbidden', 403);
  if (statusCode === 404) return errorResponse('User not found', 404);
  return errorResponse('Could not load or save your profile. Please try again.', 500);
}

/** GET /api/v1/settings/user - Get current user profile */
export async function GET() {
  try {
    return NextResponse.json(await getUserProfile());
  } catch (err) {
    return handleError(err);
  }
}

/** PUT /api/v1/settings/user - Update current user profile */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Request body must be valid JSON', 400);
  }

  const parsed = userProfileUpdateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return errorResponse('Validation failed', 400, {
      fieldErrors,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  try {
    return NextResponse.json(await updateUserProfile(parsed.data));
  } catch (err) {
    return handleError(err);
  }
}
