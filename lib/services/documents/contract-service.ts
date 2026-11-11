'use server';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  ContractCreateInput,
  ContractUpdateInput,
  ContractSignInput,
} from '@/lib/schemas/documents/contract.schema';

export interface SignatureAuditEntry {
  id: string;
  signerName: string;
  signerEmail: string;
  signedAt: Date;
  signatureMethod: string;
  signatureReference: string | null;
}

interface ContractRecord {
  id: string;
  organizationId: string;
  proposalId: string | null;
  projectId: string | null;
  title: string;
  status: string;
  signatureReference: string | null;
  signedAt: Date | null;
  signedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  proposal?: { id: string; number: string; title: string; status: string } | null;
  project?: { id: string; name: string; status: string } | null;
  signer?: { id: string; name: string | null; email: string | null } | null;
  signatures?: SignatureAuditEntry[];
}

export interface ContractResponse {
  id: string;
  organizationId: string;
  proposalId: string | null;
  projectId: string | null;
  title: string;
  status: string;
  signatureReference: string | null;
  signedAt: Date | null;
  signedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  proposal: { id: string; number: string; title: string; status: string } | null;
  project: { id: string; name: string; status: string } | null;
  signer: { id: string; name: string | null; email: string | null } | null;
  signatures?: SignatureAuditEntry[];
}

const EDITABLE_CONTRACT_STATUSES = ['draft', 'sent'];

const VALID_CONTRACT_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'voided'],
  sent: ['voided'],
  signed: [], // immutable
  voided: [], // immutable
};

function codedError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function serializeContract(c: ContractRecord): ContractResponse {
  return {
    id: c.id,
    organizationId: c.organizationId,
    proposalId: c.proposalId,
    projectId: c.projectId,
    title: c.title,
    status: c.status,
    signatureReference: c.signatureReference,
    signedAt: c.signedAt,
    signedBy: c.signedBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    proposal: c.proposal
      ? {
          id: c.proposal.id,
          number: c.proposal.number,
          title: c.proposal.title,
          status: c.proposal.status,
        }
      : null,
    project: c.project
      ? { id: c.project.id, name: c.project.name, status: c.project.status }
      : null,
    signer: c.signer ? { id: c.signer.id, name: c.signer.name, email: c.signer.email } : null,
    ...(c.signatures
      ? {
          signatures: c.signatures.map((s) => ({
            id: s.id,
            signerName: s.signerName,
            signerEmail: s.signerEmail,
            signedAt: s.signedAt,
            signatureMethod: s.signatureMethod,
            signatureReference: s.signatureReference,
          })),
        }
      : {}),
  };
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    throw codedError('Unauthenticated', 401);
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

async function createAuditLog({
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
  await prisma.auditLog.create({
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

export async function listContracts(): Promise<ContractResponse[]> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contract.read');

  const contracts = (await prisma.contract.findMany({
    where: { organizationId },
    include: {
      proposal: { select: { id: true, number: true, title: true, status: true } },
      project: { select: { id: true, name: true, status: true } },
      signer: { select: { id: true, name: true, email: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })) as ContractRecord[];

  return contracts.map(serializeContract);
}

export async function getContract(id: string): Promise<ContractResponse> {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contract.read');

  const contract = (await prisma.contract.findFirst({
    where: { id, organizationId },
    include: {
      proposal: { select: { id: true, number: true, title: true, status: true } },
      project: { select: { id: true, name: true, status: true } },
      signer: { select: { id: true, name: true, email: true } },
      signatures: {
        orderBy: { signedAt: 'desc' },
        select: {
          id: true,
          signerName: true,
          signerEmail: true,
          signedAt: true,
          signatureMethod: true,
          signatureReference: true,
        },
      },
    },
  })) as ContractRecord | null;

  if (!contract) {
    throw codedError('Not found', 404);
  }

  return serializeContract(contract);
}

export async function createContract(input: ContractCreateInput): Promise<ContractResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contract.create');

  if (input.status === ('signed' as string)) {
    throw codedError('Contracts cannot be created directly in signed status', 400);
  }

  // Validate proposal belongs to same org if provided
  if (input.proposalId) {
    const proposal = await prisma.proposal.findFirst({
      where: { id: input.proposalId, organizationId },
    });
    if (!proposal || (proposal as { deletedAt?: Date | null }).deletedAt) {
      throw codedError('Proposal not found', 404);
    }
  }

  // Validate project belongs to same org if provided
  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId },
    });
    if (!project || (project as { deletedAt?: Date | null }).deletedAt) {
      throw codedError('Project not found', 404);
    }
  }

  const contract = (await prisma.contract.create({
    data: {
      organizationId,
      proposalId: input.proposalId ?? null,
      projectId: input.projectId ?? null,
      title: input.title,
      status: input.status,
    },
    include: {
      proposal: { select: { id: true, number: true, title: true, status: true } },
      project: { select: { id: true, name: true, status: true } },
    },
  })) as ContractRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'contract.create',
    entityType: 'Contract',
    entityId: contract.id,
    after: {
      id: contract.id,
      title: contract.title,
      status: contract.status,
      proposalId: contract.proposalId,
      projectId: contract.projectId,
    },
    organizationId,
  });

  return serializeContract(contract);
}

export async function updateContract(
  id: string,
  input: ContractUpdateInput
): Promise<ContractResponse> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contract.update');

  const existing = await prisma.contract.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw codedError('Not found', 404);
  }

  // Signed and voided contracts are immutable
  if (!EDITABLE_CONTRACT_STATUSES.includes(existing.status)) {
    throw codedError(`Cannot modify a ${existing.status} contract`, 400);
  }

  if (input.status !== undefined) {
    if (input.status === ('signed' as string)) {
      throw codedError('Use the contract signing endpoint to sign a contract', 400);
    }
    if (input.status !== existing.status) {
      const allowed = VALID_CONTRACT_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw codedError(
          `Invalid contract status transition from ${existing.status} to ${input.status}`,
          400
        );
      }
    }
  }

  // Validate cross-org proposalId if provided
  if (input.proposalId !== undefined && input.proposalId !== null) {
    const proposal = await prisma.proposal.findFirst({
      where: { id: input.proposalId, organizationId },
    });
    if (!proposal || (proposal as { deletedAt?: Date | null }).deletedAt) {
      throw codedError('Proposal not found', 404);
    }
  }

  // Validate cross-org projectId if provided
  if (input.projectId !== undefined && input.projectId !== null) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId },
    });
    if (!project || (project as { deletedAt?: Date | null }).deletedAt) {
      throw codedError('Project not found', 404);
    }
  }

  const contract = (await prisma.contract.update({
    where: { id },
    data: {
      proposalId: input.proposalId !== undefined ? input.proposalId : existing.proposalId,
      projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
      title: input.title ?? existing.title,
      status: input.status ?? existing.status,
    },
    include: {
      proposal: { select: { id: true, number: true, title: true, status: true } },
      project: { select: { id: true, name: true, status: true } },
      signer: { select: { id: true, name: true, email: true } },
    },
  })) as ContractRecord;

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'contract.update',
    entityType: 'Contract',
    entityId: contract.id,
    before: {
      id: existing.id,
      title: existing.title,
      status: existing.status,
      proposalId: existing.proposalId,
      projectId: existing.projectId,
    },
    after: {
      id: contract.id,
      title: contract.title,
      status: contract.status,
      proposalId: contract.proposalId,
      projectId: contract.projectId,
    },
    organizationId,
  });

  return serializeContract(contract);
}

export async function signContract(
  id: string,
  input: ContractSignInput,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<{
  id: string;
  status: string;
  signedAt: Date | null;
  signedBy: string | null;
  signatureReference: string | null;
}> {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contract.sign');

  const contract = await prisma.contract.findFirst({
    where: { id, organizationId },
  });

  if (!contract) {
    throw codedError('Not found', 404);
  }

  if (contract.status === 'signed') {
    throw codedError('Contract is already signed', 400);
  }

  if (contract.status === 'voided') {
    throw codedError('Cannot sign a voided contract', 400);
  }

  const runInTx = async (tx: typeof prisma) => {
    const signedContract = await tx.contract.update({
      where: { id },
      data: {
        status: 'signed',
        signedAt: new Date(),
        signedBy: userId,
        signatureReference: input.signatureReference ?? null,
      },
    });

    await tx.signature.create({
      data: {
        organizationId,
        contractId: id,
        signerName: input.signerName,
        signerEmail: input.signerEmail,
        signatureMethod: 'audit_trail',
        signatureReference: input.signatureReference ?? null,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });

    return signedContract;
  };

  const updated =
    typeof prisma.$transaction === 'function'
      ? await prisma.$transaction((tx: typeof prisma) => runInTx(tx))
      : await runInTx(prisma);

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'contract.sign',
    entityType: 'Contract',
    entityId: id,
    before: { status: contract.status },
    after: {
      status: 'signed',
      signedAt: updated.signedAt,
      signerName: input.signerName,
      signerEmail: input.signerEmail,
    },
    organizationId,
    ipAddress,
    userAgent,
  });

  return {
    id: updated.id,
    status: updated.status,
    signedAt: updated.signedAt,
    signedBy: updated.signedBy,
    signatureReference: updated.signatureReference,
  };
}

export async function deleteContract(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'contract.delete');

  const existing = await prisma.contract.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw codedError('Not found', 404);
  }

  if (existing.status === 'signed') {
    throw codedError('Cannot delete a signed contract', 400);
  }

  await prisma.contract.delete({
    where: { id },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'contract.delete',
    entityType: 'Contract',
    entityId: id,
    before: { id: existing.id, title: existing.title, status: existing.status },
    after: null,
    organizationId,
  });

  return { id };
}
