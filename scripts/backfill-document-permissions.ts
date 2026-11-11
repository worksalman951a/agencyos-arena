/**
 * Backfill CRM permissions (proposal, quotation, invoice, project) to existing Administrator roles.
 *
 * These permission codes are assigned to the Administrator role during organization bootstrap.
 * Organizations bootstrapped before these codes were added, or whose Administrator role was
 * created without them, are missing them.
 *
 * This script is idempotent:
 * - Ensures each permission code exists (upsert, no-op if present)
 * - Assigns each permission to every Administrator role (isSystem=true AND name='Administrator')
 * - Safe to run multiple times; produces no duplicates
 * - Non-Administrator system roles are intentionally excluded.
 *
 * Usage (Windows PowerShell):
 *   $env:DATABASE_URL="postgresql://..."; npm run db:backfill-document-permissions
 *
 * Or with .env.local (DATABASE_URL is loaded automatically):
 *   npm run db:backfill-document-permissions
 */

import dotenv from 'dotenv';

// Load .env.local so DATABASE_URL is available without manual export
dotenv.config({ path: '.env.local' });

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg(process.env.DATABASE_URL);

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

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
  'contract.create',
  'contract.read',
  'contract.update',
  'contract.delete',
  'contract.sign',
  'document.create',
  'document.read',
  'document.update',
  'document.delete',
  'document.share',
  'template.create',
  'template.read',
  'template.update',
  'template.delete',
];

async function backfill() {
  console.log('Starting CRM permission backfill...');

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Define it in .env.local or export it before running.'
    );
  }

  // 1. Ensure permission codes exist (idempotent upsert)
  for (const code of CRM_PERMISSION_CODES) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: {
        code,
        description: `CRM permission: ${code}`,
      },
    });
  }
  console.log(`Ensured ${CRM_PERMISSION_CODES.length} CRM permission code(s) exist.`);

  // 2. Fetch all Administrator roles across all organizations.
  // Restrict to name='Administrator' so unrelated system roles (if any)
  // never receive CRM permissions.
  const adminRoles = await prisma.role.findMany({
    where: {
      isSystem: true,
      name: 'Administrator',
    },
    include: {
      permissions: { include: { permission: true } },
    },
  });

  console.log(`Found ${adminRoles.length} Administrator role(s).`);

  // 3. For each role, assign any missing CRM permissions (idempotent)
  let totalAssigned = 0;
  for (const role of adminRoles) {
    const existingCodes = new Set(
      (role.permissions as Array<{ permission: { code: string } }>).map((rp) => rp.permission.code)
    );
    const missing = CRM_PERMISSION_CODES.filter((code) => !existingCodes.has(code));

    if (missing.length > 0) {
      const permissions = await prisma.permission.findMany({
        where: { code: { in: missing } },
      });
      await prisma.rolePermission.createMany({
        data: permissions.map((p: { id: string }) => ({
          roleId: role.id,
          permissionId: p.id,
        })),
        skipDuplicates: true,
      });
      totalAssigned += missing.length;
      console.log(`  Role ${role.id} (org ${role.organizationId}): assigned ${missing.join(', ')}`);
    } else {
      console.log(
        `  Role ${role.id} (org ${role.organizationId}): already has all CRM permissions`
      );
    }
  }

  console.log(
    `Backfill complete. Assigned ${totalAssigned} CRM permission(s) across ${adminRoles.length} role(s).`
  );

  await prisma.$disconnect();
}

backfill().catch(async (err) => {
  console.error('Backfill failed:', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
