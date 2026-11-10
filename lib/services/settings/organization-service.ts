'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  normalizeOrganizationSettings,
  organizationSettingsPatchSchema,
  settingsPatchFromParsed,
  fieldErrorsFromIssues,
  type OrganizationSettings,
} from '@/lib/schemas/settings/organization.schema';
import {
  previewNextDocumentNumber,
  type DocumentKind,
  type NumberingPreview,
} from '@/lib/services/settings/document-numbering';

/** Serialized organization with normalized, fully-typed settings. */
export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  settings: OrganizationSettings;
  /** The number the next created document will actually receive. */
  nextNumbers: Record<DocumentKind, NumberingPreview>;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

/** Validation failure carrying per-field messages for inline display. */
export class SettingsValidationError extends Error {
  statusCode = 400;
  fieldErrors: Record<string, string>;
  issues: Array<{ path: string; message: string }>;

  constructor(
    fieldErrors: Record<string, string>,
    issues: Array<{ path: string; message: string }>
  ) {
    super('Validation failed');
    this.name = 'SettingsValidationError';
    this.fieldErrors = fieldErrors;
    this.issues = issues;
  }
}

/** Validate session and resolve authorized user context */
async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    throw httpError('Unauthenticated', 401);
  }

  const user = result.user as { role?: string; organizationId?: string };
  const { organizationId } = await requireOrganization(result.user.id);
  return {
    userId: result.user.id,
    organizationId,
    email: result.user.email ?? '',
    role: user.role ?? 'employee',
  };
}

/** Check if the user is an Administrator of their organization */
async function isOrganizationAdmin(userId: string, organizationId: string): Promise<boolean> {
  const userRole = await prisma.userRole.findFirst({
    where: { userId, organizationId },
    include: {
      role: true,
    },
  });
  return !!userRole?.role && userRole.role.isSystem && userRole.role.name === 'Administrator';
}

async function nextNumbersFor(
  organizationId: string,
  settings: Record<string, unknown>
): Promise<Record<DocumentKind, NumberingPreview>> {
  const [invoice, proposal] = await Promise.all([
    previewNextDocumentNumber(organizationId, 'invoice', settings),
    previewNextDocumentNumber(organizationId, 'proposal', settings),
  ]);
  return { invoice, proposal };
}

async function serializeOrganization(
  organization: {
    id: string;
    name: string;
    slug: string;
    domain: string | null;
    settings: unknown;
    createdAt: Date;
    updatedAt: Date;
  },
  isAdmin: boolean
): Promise<OrganizationResponse> {
  const settings = normalizeOrganizationSettings(organization.settings);
  const nextNumbers = await nextNumbersFor(organization.id, {
    ...settings,
  } as Record<string, unknown>);

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    domain: organization.domain,
    settings,
    nextNumbers,
    isAdmin,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

/** Get organization settings for the current user's organization */
export async function getOrganizationSettings(): Promise<OrganizationResponse> {
  const { userId, organizationId } = await getAuthorizedUser();

  // Any authenticated user can read their organization's settings
  await requirePermission(userId, organizationId, 'invoice.read');

  // isOrganizationAdmin is a plain promise, not a Prisma operation, so it
  // cannot be mixed into prisma.$transaction — Promise.all is correct here.
  const [organization, isAdmin] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        settings: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    isOrganizationAdmin(userId, organizationId),
  ]);

  if (!organization) throw httpError('Not found', 404);

  return serializeOrganization(organization, isAdmin);
}

/**
 * Update organization settings (Administrator only).
 *
 * The payload is validated with the shared zod schema before anything is
 * written. Only keys present in the payload are touched, so the UI can save one
 * section at a time; `null` clears an optional field (deleting the key) instead
 * of being dropped by JSON serialization.
 */
export async function updateOrganizationSettings(input: {
  name?: string;
  settings?: unknown;
}): Promise<OrganizationResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  // Only Administrators can update organization-level settings
  if (!(await isOrganizationAdmin(userId, organizationId))) {
    throw httpError('Forbidden: organization settings require Administrator role', 403);
  }

  // 1. Settings patch validation (before any read/write).
  let patch: { set: Record<string, string | number>; clear: string[] } = { set: {}, clear: [] };
  if (input.settings !== undefined) {
    const parsed = organizationSettingsPatchSchema.safeParse(input.settings);
    if (!parsed.success) {
      throw new SettingsValidationError(
        fieldErrorsFromIssues(parsed.error.issues),
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
      );
    }
    patch = settingsPatchFromParsed(parsed.data);
  }

  // 2. Validate the organization name explicitly (the settings and the name are
  //    edited in different sections of the same page).
  if (input.name !== undefined && input.name.trim().length === 0) {
    throw new SettingsValidationError({ name: 'Organization name is required' }, [
      { path: 'name', message: 'Organization name is required' },
    ]);
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, settings: true },
  });

  if (!organization) throw httpError('Not found', 404);

  const current = (organization.settings as Record<string, unknown> | null) ?? {};
  const nextSettings = { ...current };
  for (const key of patch.clear) delete nextSettings[key];
  Object.assign(nextSettings, patch.set);

  const data: { name?: string; settings: Record<string, unknown> } = {
    settings: nextSettings,
  };
  if (input.name !== undefined) data.name = input.name.trim();

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data,
    select: {
      id: true,
      name: true,
      slug: true,
      domain: true,
      settings: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      actorName: actorEmail || null,
      action: 'organization.settings.update',
      entityType: 'Organization',
      entityId: organizationId,
      before: { name: organization.name },
      after: { name: updated.name },
      metadata: {
        changedFields: [...Object.keys(patch.set), ...patch.clear],
        clearedFields: patch.clear,
      },
    },
  });

  return serializeOrganization(updated, true);
}
