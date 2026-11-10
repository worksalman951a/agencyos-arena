/**
 * AgencyOS Settings API - Organization
 *
 * GET    /api/v1/settings/organization - Get organization settings
 * PUT    /api/v1/settings/organization - Update organization settings (Admin only)
 *
 * Organization ID is resolved from the authenticated user's session, never
 * accepted from the client. Validation happens here (zod) so a bad payload can
 * never reach the JSON column, and every failure returns an honest status code
 * with per-field messages instead of a blanket `Not found`.
 */

import { NextResponse } from 'next/server';

import {
  getOrganizationSettings,
  updateOrganizationSettings,
  SettingsValidationError,
} from '@/lib/services/settings/organization-service';

interface CodedError {
  statusCode?: number;
  fieldErrors?: Record<string, string>;
  issues?: Array<{ path: string; message: string }>;
}

function statusFor(statusCode: number | undefined): number {
  return statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 400
    ? statusCode
    : 500;
}

function errorResponse(err: unknown) {
  const coded = err as CodedError;
  const status = statusFor(coded.statusCode);

  const message =
    status === 400
      ? 'Validation failed'
      : status === 401
        ? 'Unauthenticated'
        : status === 403
          ? 'Forbidden: organization settings require Administrator role'
          : status === 404
            ? 'Organization not found'
            : 'Could not load or save settings. Please try again.';

  const body: Record<string, unknown> = { error: message };
  if (coded.fieldErrors && Object.keys(coded.fieldErrors).length > 0) {
    body.fieldErrors = coded.fieldErrors;
  }
  if (coded.issues) body.issues = coded.issues;
  return NextResponse.json(body, { status });
}

/** GET /api/v1/settings/organization - Get organization settings */
export async function GET() {
  try {
    const data = await getOrganizationSettings();
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

/** PUT /api/v1/settings/organization - Update organization settings */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }

  const { name, settings } = body as { name?: unknown; settings?: unknown };

  // Shape checks happen here; field-level rules live in the shared zod schema
  // used by the service so the UI and API can never disagree.
  if (name !== undefined && typeof name !== 'string') {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: { name: 'Organization name must be text' } },
      { status: 400 }
    );
  }
  if (
    settings !== undefined &&
    (typeof settings !== 'object' || settings === null || Array.isArray(settings))
  ) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: { settings: 'Settings must be an object' } },
      { status: 400 }
    );
  }

  try {
    const data = await updateOrganizationSettings({ name, settings });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      return errorResponse(err);
    }
    return errorResponse(err);
  }
}
