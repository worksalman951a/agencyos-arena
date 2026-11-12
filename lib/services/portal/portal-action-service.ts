import { prisma } from '@/lib/db';
import { getClientPortalSession } from '@/lib/services/portal/portal-auth-service';
import {
  portalActionSchema,
  type PortalActionInput,
} from '@/lib/schemas/portal/portal-action.schema';
import { createNotification } from '@/lib/services/automation/notification-service';
import type { PrismaTransactionClient } from '@/lib/services/settings/document-numbering';

function codedError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export interface ClientActionResult {
  success: boolean;
  documentId: string;
  documentType: 'proposal' | 'quotation' | 'contract';
  status: string;
  action: 'accept' | 'reject';
  timestamp: string;
  version: string;
}

/**
 * Handle client acceptance or rejection of a Proposal with mandatory version binding.
 */
export async function executePortalProposalAction(
  input: PortalActionInput,
  meta?: { ipAddress?: string; userAgent?: string }
): Promise<ClientActionResult> {
  const context = await getClientPortalSession();
  const { organizationId, contactId, contactName, email } = context;

  const proposal = await prisma.proposal.findFirst({
    where: {
      id: input.documentId,
      organizationId,
      contactId,
      deletedAt: null,
    },
    include: {
      contact: true,
      items: true,
    },
  });

  if (!proposal) {
    throw codedError('Proposal not found or access denied', 404);
  }

  const currentVersion = proposal.updatedAt.toISOString();
  const targetStatus = input.action === 'accept' ? 'accepted' : 'rejected';

  // Idempotency: if already in target state, return safely
  if (proposal.status === targetStatus) {
    return {
      success: true,
      documentId: proposal.id,
      documentType: 'proposal',
      status: proposal.status,
      action: input.action,
      timestamp: proposal.updatedAt.toISOString(),
      version: currentVersion,
    };
  }

  // Conflicting or non-actionable status check
  if (proposal.status !== 'sent') {
    throw codedError(`Cannot ${input.action} proposal in status '${proposal.status}'`, 400);
  }

  // Mandatory version comparison
  if (input.expectedVersion !== currentVersion) {
    throw codedError('Document version has changed. Please review the latest document terms.', 409);
  }

  const now = new Date();

  // Atomic state transition using conditional update
  const result = await prisma.proposal.updateMany({
    where: {
      id: proposal.id,
      organizationId,
      contactId,
      status: 'sent',
      updatedAt: proposal.updatedAt,
    },
    data: {
      status: targetStatus,
      updatedAt: now,
    },
  });

  if (result.count === 0) {
    throw codedError('Document was modified or processed concurrently by another request', 409);
  }

  // Create audit log for client action
  await prisma.auditLog.create({
    data: {
      actorId: `portal-contact:${contactId}`,
      actorName: `${contactName} (${email})`,
      action: `portal.proposal.${input.action}`,
      entityType: 'Proposal',
      entityId: proposal.id,
      before: { status: proposal.status, version: currentVersion },
      after: {
        status: targetStatus,
        reason: input.reason || null,
        version: now.toISOString(),
        clientIp: meta?.ipAddress || null,
      },
      organizationId,
      ipAddress: meta?.ipAddress || null,
      userAgent: meta?.userAgent || null,
    },
  });

  // Notify internal agency document creator if exists
  if (proposal.createdBy) {
    try {
      await createNotification({
        userId: proposal.createdBy,
        organizationId,
        type: 'status_changed',
        title: `Proposal ${proposal.number} ${targetStatus.toUpperCase()}`,
        message: `Client ${contactName} has ${targetStatus} proposal "${proposal.title}".${input.reason ? ` Reason: ${input.reason}` : ''}`,
        link: `/sales/proposals/${proposal.id}`,
      });
    } catch {
      // Non-fatal if notification fails
    }
  }

  return {
    success: true,
    documentId: proposal.id,
    documentType: 'proposal',
    status: targetStatus,
    action: input.action,
    timestamp: now.toISOString(),
    version: now.toISOString(),
  };
}

/**
 * Handle client acceptance or rejection of a Quotation with mandatory version binding.
 */
export async function executePortalQuotationAction(
  input: PortalActionInput,
  meta?: { ipAddress?: string; userAgent?: string }
): Promise<ClientActionResult> {
  const context = await getClientPortalSession();
  const { organizationId, contactId, contactName, email } = context;

  const quotation = await prisma.quotation.findFirst({
    where: {
      id: input.documentId,
      organizationId,
      contactId,
      deletedAt: null,
    },
    include: {
      contact: true,
      items: true,
    },
  });

  if (!quotation) {
    throw codedError('Quotation not found or access denied', 404);
  }

  const currentVersion = quotation.updatedAt.toISOString();
  const targetStatus = input.action === 'accept' ? 'accepted' : 'rejected';

  if (quotation.status === targetStatus) {
    return {
      success: true,
      documentId: quotation.id,
      documentType: 'quotation',
      status: quotation.status,
      action: input.action,
      timestamp: quotation.updatedAt.toISOString(),
      version: currentVersion,
    };
  }

  if (quotation.status !== 'sent') {
    throw codedError(`Cannot ${input.action} quotation in status '${quotation.status}'`, 400);
  }

  if (input.expectedVersion !== currentVersion) {
    throw codedError('Document version has changed. Please review the latest document terms.', 409);
  }

  const now = new Date();

  const result = await prisma.quotation.updateMany({
    where: {
      id: quotation.id,
      organizationId,
      contactId,
      status: 'sent',
      updatedAt: quotation.updatedAt,
    },
    data: {
      status: targetStatus,
      updatedAt: now,
    },
  });

  if (result.count === 0) {
    throw codedError('Document was modified or processed concurrently by another request', 409);
  }

  await prisma.auditLog.create({
    data: {
      actorId: `portal-contact:${contactId}`,
      actorName: `${contactName} (${email})`,
      action: `portal.quotation.${input.action}`,
      entityType: 'Quotation',
      entityId: quotation.id,
      before: { status: quotation.status, version: currentVersion },
      after: {
        status: targetStatus,
        reason: input.reason || null,
        version: now.toISOString(),
        clientIp: meta?.ipAddress || null,
      },
      organizationId,
      ipAddress: meta?.ipAddress || null,
      userAgent: meta?.userAgent || null,
    },
  });

  if (quotation.createdBy) {
    try {
      await createNotification({
        userId: quotation.createdBy,
        organizationId,
        type: 'status_changed',
        title: `Quotation ${quotation.number} ${targetStatus.toUpperCase()}`,
        message: `Client ${contactName} has ${targetStatus} quotation "${quotation.title}".${input.reason ? ` Reason: ${input.reason}` : ''}`,
        link: `/sales/quotations/${quotation.id}`,
      });
    } catch {
      // Non-fatal
    }
  }

  return {
    success: true,
    documentId: quotation.id,
    documentType: 'quotation',
    status: targetStatus,
    action: input.action,
    timestamp: now.toISOString(),
    version: now.toISOString(),
  };
}

/**
 * Handle electronic acceptance of an authorized Contract with mandatory version binding.
 */
export async function executePortalContractAction(
  input: PortalActionInput,
  meta?: { ipAddress?: string; userAgent?: string }
): Promise<ClientActionResult> {
  const context = await getClientPortalSession();
  const { organizationId, contactId, contactName, email } = context;

  const contract = await prisma.contract.findFirst({
    where: {
      id: input.documentId,
      organizationId,
      OR: [
        { proposal: { contactId, deletedAt: null } },
        { project: { clientId: contactId, deletedAt: null } },
      ],
    },
    include: {
      proposal: true,
      project: true,
      signatures: true,
    },
  });

  if (!contract) {
    throw codedError('Contract not found or access denied', 404);
  }

  const currentVersion = contract.updatedAt.toISOString();

  if (contract.status === 'signed') {
    return {
      success: true,
      documentId: contract.id,
      documentType: 'contract',
      status: 'signed',
      action: 'accept',
      timestamp: contract.signedAt ? contract.signedAt.toISOString() : currentVersion,
      version: currentVersion,
    };
  }

  if (contract.status === 'voided') {
    throw codedError('Cannot accept a voided contract', 400);
  }

  if (input.action === 'reject') {
    throw codedError(
      'Contract rejection requires contacting your account manager to void or revise the agreement.',
      400
    );
  }

  if (!input.consentGiven) {
    throw codedError('Explicit legal acceptance consent is required.', 400);
  }

  if (input.expectedVersion !== currentVersion) {
    throw codedError('Contract terms have been updated. Please review the updated agreement.', 409);
  }

  const signerName = input.signerName?.trim() || contactName;
  const signerEmail = input.signerEmail?.trim().toLowerCase() || email;

  const now = new Date();
  const auditReference = `portal-esign-${now.getTime()}-${Math.random().toString(36).substring(2, 8)}`;

  // Atomic conditional transition inside transaction
  await prisma.$transaction(async (tx: PrismaTransactionClient) => {
    const updateResult = await tx.contract.updateMany({
      where: {
        id: contract.id,
        organizationId,
        status: contract.status,
        updatedAt: contract.updatedAt,
      },
      data: {
        status: 'signed',
        signedAt: now,
        signatureReference: auditReference,
        updatedAt: now,
      },
    });

    if (updateResult.count === 0) {
      throw codedError('Contract was signed or modified concurrently by another request', 409);
    }

    await tx.signature.create({
      data: {
        organizationId,
        contractId: contract.id,
        signerName,
        signerEmail,
        signatureMethod: 'audit_trail',
        signatureReference: auditReference,
        ipAddress: meta?.ipAddress || null,
        userAgent: meta?.userAgent || null,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: `portal-contact:${contactId}`,
        actorName: `${signerName} (${signerEmail})`,
        action: 'portal.contract.accept',
        entityType: 'Contract',
        entityId: contract.id,
        before: { status: contract.status, version: currentVersion },
        after: {
          status: 'signed',
          signedAt: now,
          signatureReference: auditReference,
          signerName,
          signerEmail,
          version: now.toISOString(),
        },
        organizationId,
        ipAddress: meta?.ipAddress || null,
        userAgent: meta?.userAgent || null,
      },
    });
  });

  const recipientUser = contract.proposal?.createdBy || contract.project?.createdBy;
  if (recipientUser) {
    try {
      await createNotification({
        userId: recipientUser,
        organizationId,
        type: 'status_changed',
        title: `Contract "${contract.title}" Signed`,
        message: `Client ${signerName} (${signerEmail}) has electronically accepted and signed contract "${contract.title}".`,
        link: `/documents/contracts/${contract.id}`,
      });
    } catch {
      // Non-fatal
    }
  }

  return {
    success: true,
    documentId: contract.id,
    documentType: 'contract',
    status: 'signed',
    action: 'accept',
    timestamp: now.toISOString(),
    version: now.toISOString(),
  };
}

/**
 * Dispatch portal actions with schema validation
 */
export async function executePortalAction(
  rawInput: unknown,
  meta?: { ipAddress?: string; userAgent?: string }
): Promise<ClientActionResult> {
  const parsed = portalActionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw codedError(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const input = parsed.data;
  if (input.documentType === 'proposal') {
    return executePortalProposalAction(input, meta);
  } else if (input.documentType === 'quotation') {
    return executePortalQuotationAction(input, meta);
  } else if (input.documentType === 'contract') {
    return executePortalContractAction(input, meta);
  }

  throw codedError('Unsupported document type', 400);
}
