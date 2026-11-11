'use server';

import { prisma } from '@/lib/db';
import {
  emitWorkflowEvent,
  emitWorkflowEvents,
} from '@/lib/services/automation/run-workflow-service';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { LeadConvertInput } from '@/lib/schemas/crm/lead-conversion.schema';

/** Conversion result returned to callers */
export interface LeadConversionResult {
  alreadyConverted: boolean;
  opportunity: {
    id: string;
    organizationId: string;
    leadId: string;
    title: string;
    status: string;
    value: string | null;
    currency: string;
    pipelineId: string | null;
    stageId: string | null;
    ownerId: string | null;
    contactId: string | null;
    accountId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  lead: {
    id: string;
    status: string;
  };
}

/** Validate session and resolve authorized user context */
async function getAuthorizedUser(): Promise<AuthorizedUser> {
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

  const user = result.user as { role?: string; organizationId?: string };
  const { organizationId } = await requireOrganization(result.user.id);
  return {
    userId: result.user.id,
    organizationId,
    email: result.user.email ?? '',
    role: user.role ?? 'employee',
  };
}

/** Create an audit log entry using the transaction client */
async function createAuditLog({
  tx,
  actorId,
  actorName,
  action,
  entityType,
  entityId,
  before,
  after,
  metadata,
  organizationId,
  ipAddress,
  userAgent,
}: {
  tx: typeof prisma;
  actorId: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  organizationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await tx.auditLog.create({
    data: {
      actorId,
      actorName,
      action,
      entityType,
      entityId,
      before: before ?? null,
      after: after ?? null,
      metadata: metadata ?? null,
      ipAddress,
      userAgent,
      organizationId,
    },
  });
}

/** Validate owner membership within the organization using the transaction client */
async function validateOwner(tx: typeof prisma, organizationId: string, ownerId: string) {
  const membership = await tx.userRole.findFirst({
    where: { userId: ownerId, organizationId },
  });
  return !!membership;
}

/**
 * Convert an eligible Lead into an Opportunity.
 *
 * Runs inside a database transaction with SELECT FOR UPDATE locking on the
 * Lead row to prevent duplicate conversions from concurrent requests.
 *
 * Steps:
 * 1. Authenticate session (401 if missing)
 * 2. Require lead.convert permission (403 if missing)
 * 3. Find and lock the Lead within the user's organization (404 if not found / cross-org)
 * 4. Check for an existing Opportunity linked to this Lead (already converted)
 * 5. Validate cross-org pipeline/stage/owner relationships
 * 6. Create Opportunity with leadId traceability + sensible defaults from Lead
 * 7. Update Lead status to 'converted'
 * 8. Audit log both the conversion and the Lead update
 */
export async function convertLead(
  leadId: string,
  input: LeadConvertInput
): Promise<LeadConversionResult> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'lead.convert');

  const result = await prisma.$transaction(
    async (tx: typeof prisma) => {
      // Lock the Lead row to serialize concurrent conversion attempts
      await tx.$queryRawUnsafe('SELECT id FROM "Lead" WHERE id = $1 FOR UPDATE', leadId);

      // Re-fetch the Lead inside the lock
      const lead = await tx.lead.findUnique({
        where: { id: leadId },
      });

      if (!lead || lead.organizationId !== organizationId) {
        const error = new Error('Not found') as Error & {
          statusCode?: number;
        };
        error.statusCode = 404;
        throw error;
      }

      // Check if already converted (an Opportunity already links to this Lead)
      const existingOpportunity = await tx.opportunity.findFirst({
        // Organization id is part of the predicate as well as the post-check:
        // the lead is already scoped, and this keeps the two in lock-step.
        where: { leadId, organizationId },
      });

      if (existingOpportunity) {
        return {
          alreadyConverted: true,
          opportunity: {
            id: existingOpportunity.id,
            organizationId: existingOpportunity.organizationId,
            leadId: existingOpportunity.leadId!,
            title: existingOpportunity.title,
            status: existingOpportunity.status,
            value: existingOpportunity.value?.toString() ?? null,
            currency: existingOpportunity.currency,
            pipelineId: existingOpportunity.pipelineId,
            stageId: existingOpportunity.stageId,
            ownerId: existingOpportunity.ownerId,
            contactId: existingOpportunity.contactId,
            accountId: existingOpportunity.accountId,
            createdAt: existingOpportunity.createdAt,
            updatedAt: existingOpportunity.updatedAt,
          },
          lead: {
            id: lead.id,
            status: lead.status,
          },
        };
      }

      // Validate cross-org pipeline relationship if pipelineId is provided
      if (input.pipelineId) {
        const pipeline = await tx.pipeline.findFirst({
          where: { id: input.pipelineId, organizationId },
        });
        if (!pipeline) {
          const error = new Error('Not found') as Error & {
            statusCode?: number;
          };
          error.statusCode = 404;
          throw error;
        }
      }

      // Validate cross-org stage relationship if stageId is provided — stage
      // must belong to the same organization (via its pipeline).
      if (input.stageId) {
        const pipelineId = input.pipelineId ?? lead.pipelineId ?? null;
        const stage = await tx.pipelineStage.findFirst({
          where: {
            id: input.stageId,
            ...(pipelineId ? { pipelineId } : { pipeline: { organizationId } }),
          },
          include: { pipeline: true },
        });
        if (!stage) {
          const error = new Error('Not found') as Error & {
            statusCode?: number;
          };
          error.statusCode = 404;
          throw error;
        }
        // Ensure stage belongs to the same pipeline if both are provided
        if (input.pipelineId && stage.pipelineId !== input.pipelineId) {
          const error = new Error('Not found') as Error & {
            statusCode?: number;
          };
          error.statusCode = 404;
          throw error;
        }
      }

      // Validate owner membership if an owner is assigned
      if (input.ownerId) {
        const isMember = await validateOwner(tx, organizationId, input.ownerId);
        if (!isMember) {
          const error = new Error('Not found') as Error & {
            statusCode?: number;
          };
          error.statusCode = 404;
          throw error;
        }
      }

      // Build sensible defaults from the Lead
      const pipelineId = input.pipelineId ?? lead.pipelineId ?? null;
      const stageId = input.stageId ?? lead.stageId ?? null;
      const ownerId = input.ownerId ?? lead.ownerId ?? null;
      const contactId = lead.contactId;
      const accountId = lead.accountId;

      // Create the Opportunity with leadId traceability
      const opportunity = await tx.opportunity.create({
        data: {
          organizationId,
          contactId: contactId ?? null,
          accountId: accountId ?? null,
          leadId: lead.id,
          pipelineId,
          stageId,
          title: input.title,
          description: input.description ?? null,
          value: input.value ? Number(input.value) : (lead.expectedValue ?? null),
          currency: input.currency ?? 'USD',
          closeDate: input.closeDate ? new Date(input.closeDate) : null,
          ownerId,
          status: 'open',
          probability: null,
          lossReason: null,
        },
      });

      // Update Lead status to 'converted'
      const updatedLead = await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'converted' },
      });

      // Audit log the conversion (Opportunity creation)
      await createAuditLog({
        tx,
        actorId: userId,
        actorName: actorEmail,
        action: 'lead.convert',
        entityType: 'Opportunity',
        entityId: opportunity.id,
        before: null,
        after: {
          id: opportunity.id,
          title: opportunity.title,
          status: opportunity.status,
          value: opportunity.value,
          currency: opportunity.currency,
          leadId: opportunity.leadId,
          pipelineId: opportunity.pipelineId,
          stageId: opportunity.stageId,
          ownerId: opportunity.ownerId,
        },
        metadata: {
          sourceLeadId: lead.id,
          sourceLeadStatus: lead.status,
        },
        organizationId,
      });

      // Audit log the Lead status update
      await createAuditLog({
        tx,
        actorId: userId,
        actorName: actorEmail,
        action: 'lead.convert',
        entityType: 'Lead',
        entityId: lead.id,
        before: {
          id: lead.id,
          status: lead.status,
        },
        after: {
          id: updatedLead.id,
          status: updatedLead.status,
        },
        metadata: {
          convertedToOpportunityId: opportunity.id,
        },
        organizationId,
      });

      return {
        alreadyConverted: false,
        previousLeadStatus: lead.status,
        opportunity: {
          id: opportunity.id,
          organizationId: opportunity.organizationId,
          leadId: opportunity.leadId!,
          title: opportunity.title,
          status: opportunity.status,
          value: opportunity.value?.toString() ?? null,
          currency: opportunity.currency,
          pipelineId: opportunity.pipelineId,
          stageId: opportunity.stageId,
          ownerId: opportunity.ownerId,
          contactId: opportunity.contactId,
          accountId: opportunity.accountId,
          createdAt: opportunity.createdAt,
          updatedAt: opportunity.updatedAt,
        },
        lead: {
          id: updatedLead.id,
          status: updatedLead.status,
        },
      };
    },
    { maxWait: 5000, timeout: 10000 }
  );

  const conversion = result as LeadConversionResult & { previousLeadStatus?: string };
  if (!conversion.alreadyConverted) {
    await emitWorkflowEvent({
      type: 'record.created',
      recordType: 'Opportunity',
      recordId: conversion.opportunity.id,
    });
    await emitWorkflowEvents([
      { type: 'record.updated', recordType: 'Lead', recordId: conversion.lead.id },
      {
        type: 'record.status_changed',
        recordType: 'Lead',
        recordId: conversion.lead.id,
        previousStatus: conversion.previousLeadStatus ?? null,
      },
    ]);
  }

  const publicResult = { ...conversion } as LeadConversionResult & {
    previousLeadStatus?: string;
  };
  delete publicResult.previousLeadStatus;
  return publicResult;
}
