/**
 * Audit-trail helper for client-portal actions.
 *
 * Reuses the platform `AuditLog` table (and therefore the existing admin audit
 * viewer) instead of introducing a second log. Client actions are recorded with
 * the client's user id as actor plus `actorType: "client"` in metadata, so an
 * administrator can tell a client response from an internal one.
 */

import { prisma } from '@/lib/db';

export interface PortalAuditInput {
  organizationId: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export async function writePortalAudit(input: PortalAuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
      metadata: input.metadata ?? null,
    },
  });
}
