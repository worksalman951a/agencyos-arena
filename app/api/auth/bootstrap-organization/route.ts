/**
 * AgencyOS Organization Bootstrap API
 *
 * POST /api/auth/bootstrap-organization
 *
 * Creates an organization for the authenticated user, assigns them to an
 * admin role with CRM permissions, and links their user record to the
 * organization. Called after registration to complete the bootstrap flow.
 *
 * Security:
 * - Requires a valid database-backed session (401 if missing/invalid)
 * - Organization ID is never trusted from the client
 * - No global administrative privileges are assigned by default
 * - One bootstrap per user (idempotent if user already has an organization)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';

import { auth } from '@/lib/auth-server';
import { prisma } from '@/lib/db';

const bootstrapSchema = z.object({
  organizationName: z.string().min(1, 'Organization name is required').max(200),
});

/** CRM permission codes that the admin role gets by default */
const CRM_PERMISSION_CODES = [
  'contact.create',
  'contact.read',
  'contact.update',
  'contact.delete',
  'account.create',
  'account.read',
  'account.update',
  'account.delete',
  'pipeline.create',
  'pipeline.read',
  'pipeline.update',
  'pipeline.delete',
  'pipeline.stage.manage',
  'lead.create',
  'lead.read',
  'lead.update',
  'lead.delete',
  'lead.assign',
  'lead.convert',
  'opportunity.create',
  'opportunity.read',
  'opportunity.update',
  'opportunity.delete',
  'opportunity.assign',
  'proposal.create',
  'proposal.read',
  'proposal.update',
  'proposal.delete',
  'quotation.create',
  'quotation.read',
  'quotation.update',
  'quotation.delete',
  'invoice.create',
  'invoice.read',
  'invoice.update',
  'invoice.delete',
  'project.create',
  'project.read',
  'project.update',
  'project.delete',
  'project.template.read',
  'project.template.create',
  'project.template.update',
  'project.template.delete',
  'project.file.read',
  'project.file.create',
  'project.file.delete',
  'project.approval.read',
  'project.approval.create',
  'project.approval.update',
  'time.entry.read',
  'time.entry.create',
  'time.entry.update',
  'time.entry.delete',
  'change.order.read',
  'change.order.create',
  'change.order.update',
  'change.order.delete',
  'task.comment.read',
  'task.comment.create',
  'task.comment.update',
  'task.comment.delete',
  'estimate.create',
  'estimate.read',
  'estimate.update',
  'estimate.delete',
  'expense.create',
  'expense.read',
  'expense.update',
  'expense.delete',
  'tax_settings.read',
  'tax_settings.update',
  'notification.read',
  'notification.update',
  'workflow.read',
  'workflow.update',
  'workflow.delete',
  'audit_log.read',
  'user.read',
  'user.update',
  'user.delete',
  'role.read',
  'role.update',
  'role.delete',
  'feature_flag.read',
  'feature_flag.update',
];

/** Validate session and return the authenticated user */
async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    const error = new Error('Unauthenticated') as Error & {
      statusCode?: number;
    };
    error.statusCode = 401;
    throw error;
  }

  return result.user as { id: string; email: string | null };
}

/**
 * Ensure CRM permissions exist in the database using the transaction client.
 *
 * Permission codes are global (unique across organizations), so two users
 * bootstrapping at the same time would race on a per-row upsert and one would
 * fail with a unique-constraint error. A single `createMany` with
 * `skipDuplicates` inserts all missing codes atomically and is race-safe.
 */
async function ensureCrmPermissions(tx: typeof prisma) {
  await tx.permission.createMany({
    data: CRM_PERMISSION_CODES.map((code) => ({
      code,
      description: `CRM permission: ${code}`,
    })),
    skipDuplicates: true,
  });
}

/** POST /api/auth/bootstrap-organization */
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();

    const body = await request.json();
    const parsed = bootstrapSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { organizationName } = parsed.data;

    // Generate a unique slug from the organization name
    const baseSlug = organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    // Create organization, role, permissions, and user membership atomically.
    // Uses SELECT ... FOR UPDATE to lock the user row, ensuring only one
    // concurrent bootstrap can succeed per user. The lock is held for the
    // entire transaction, so the second request blocks until the first
    // commits, then sees organizationId already set and returns 409.
    const result = await prisma.$transaction(
      async (tx: typeof prisma) => {
        // 1. Lock the user row to serialize concurrent bootstrap attempts
        await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', user.id);

        // 2. Check organizationId inside the lock (defense against TOCTOU)
        const lockedUser = await tx.user.findUnique({
          where: { id: user.id },
          select: { organizationId: true },
        });
        if (lockedUser?.organizationId) {
          const err = new Error('Organization already bootstrapped') as Error & {
            statusCode: number;
          };
          err.statusCode = 409;
          throw err;
        }

        // 3. Create the organization
        const organization = await tx.organization.create({
          data: {
            name: organizationName,
            slug,
          },
        });

        // 4. Ensure CRM permissions exist (using transaction client)
        await ensureCrmPermissions(tx);

        // 5. Create an admin role for this organization
        const role = await tx.role.create({
          data: {
            name: 'Administrator',
            description: 'Full access to all organization resources',
            organizationId: organization.id,
            isSystem: true,
          },
        });

        // 6. Assign all CRM permissions to the admin role
        const permissions = await tx.permission.findMany({
          where: { code: { in: CRM_PERMISSION_CODES } },
        });
        await tx.rolePermission.createMany({
          data: permissions.map((p: { id: string }) => ({
            roleId: role.id,
            permissionId: p.id,
          })),
        });

        // 7. Assign the user to the admin role in this organization
        const userRole = await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
            organizationId: organization.id,
            assignedBy: user.id,
          },
        });

        // 8. Link the user to the organization (lock held, no race possible)
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { organizationId: organization.id },
        });

        return { organization, role, userRole, user: updatedUser };
      },
      { maxWait: 5000, timeout: 10000 }
    );

    return NextResponse.json({
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
      },
      user: {
        id: result.user.id,
        email: result.user.email,
        organizationId: result.user.organizationId,
      },
    });
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json(
      { error: statusCode === 401 ? 'Unauthenticated' : 'Internal error' },
      { status: statusCode }
    );
  }
}
