/**
 * Organization-scoped existence checks for portal-shareable resources.
 *
 * Every lookup takes the organization from the caller's session/portal context
 * and filters on it. A caller-supplied resource id that belongs to another tenant
 * therefore resolves to `null` — the same answer as a non-existent id — so the
 * portal cannot be used as an oracle for "does this id exist elsewhere".
 */

import { prisma } from '@/lib/db';
import type { PortalResourceType } from '@/lib/portal/resource-registry';

export interface PortalResourceSummary {
  type: PortalResourceType;
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
}

type Lookup = (id: string, organizationId: string) => Promise<PortalResourceSummary | null>;

const LOOKUPS: Record<PortalResourceType, Lookup> = {
  project: async (id, organizationId) => {
    const project = await prisma.project.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, name: true, description: true, status: true },
    });
    return project
      ? {
          type: 'project',
          id: project.id,
          title: project.name,
          subtitle: project.description ?? null,
          status: project.status,
        }
      : null;
  },

  document: async (id, organizationId) => {
    const document = await prisma.document.findFirst({
      where: { id, organizationId },
      select: { id: true, title: true, type: true, visibility: true },
    });
    return document
      ? {
          type: 'document',
          id: document.id,
          title: document.title,
          subtitle: document.type,
          status: document.visibility,
        }
      : null;
  },

  proposal: async (id, organizationId) => {
    const proposal = await prisma.proposal.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, title: true, number: true, status: true },
    });
    return proposal
      ? {
          type: 'proposal',
          id: proposal.id,
          title: proposal.title,
          subtitle: proposal.number,
          status: proposal.status,
        }
      : null;
  },

  quotation: async (id, organizationId) => {
    const quotation = await prisma.quotation.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, title: true, number: true, status: true },
    });
    return quotation
      ? {
          type: 'quotation',
          id: quotation.id,
          title: quotation.title,
          subtitle: quotation.number,
          status: quotation.status,
        }
      : null;
  },

  estimate: async (id, organizationId) => {
    const estimate = await prisma.estimate.findFirst({
      where: { id, organizationId },
      select: { id: true, number: true, status: true },
    });
    return estimate
      ? {
          type: 'estimate',
          id: estimate.id,
          title: `Estimate ${estimate.number}`,
          subtitle: estimate.number,
          status: estimate.status,
        }
      : null;
  },

  contract: async (id, organizationId) => {
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId },
      select: { id: true, title: true, status: true, signedAt: true },
    });
    return contract
      ? {
          type: 'contract',
          id: contract.id,
          title: contract.title,
          subtitle: contract.signedAt ? 'Signed' : null,
          status: contract.status,
        }
      : null;
  },

  invoice: async (id, organizationId) => {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, title: true, number: true, status: true },
    });
    return invoice
      ? {
          type: 'invoice',
          id: invoice.id,
          title: invoice.title,
          subtitle: invoice.number,
          status: invoice.status,
        }
      : null;
  },

  file: async (id, organizationId) => {
    const file = await prisma.projectFile.findFirst({
      where: { id, organizationId, fileAsset: { organizationId } },
      select: {
        id: true,
        fileAsset: { select: { id: true, originalName: true, mimeType: true } },
      },
    });
    return file
      ? {
          type: 'file',
          id: file.id,
          title: file.fileAsset.originalName,
          subtitle: file.fileAsset.mimeType,
          status: null,
        }
      : null;
  },
};

/** Resolve a resource inside one organization, or null if it is not there. */
export async function findResourceInOrganization(
  type: PortalResourceType,
  id: string,
  organizationId: string
): Promise<PortalResourceSummary | null> {
  return LOOKUPS[type](id, organizationId);
}

/** True when the resource exists in the organization. */
export async function resourceExistsInOrganization(
  type: PortalResourceType,
  id: string,
  organizationId: string
): Promise<boolean> {
  return (await findResourceInOrganization(type, id, organizationId)) !== null;
}
