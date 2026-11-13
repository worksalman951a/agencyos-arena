import {
  getClientPortalInvoice,
  getClientPortalProposal,
  getClientPortalQuotation,
  getClientPortalContract,
} from '@/lib/services/portal/portal-data-service';
import {
  generateInvoicePdf,
  generateProposalPdf,
  generateQuotationPdf,
  generateContractPdf,
} from '@/lib/services/documents/pdf-service';
import { getBrandingForOrganization } from '@/lib/services/settings/branding-service';
import { getClientPortalSession } from '@/lib/services/portal/portal-auth-service';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';
import type { ProposalResponse } from '@/lib/services/crm/proposal-service';
import type { QuotationResponse } from '@/lib/services/crm/quotation-service';
import type { ContractResponse } from '@/lib/services/documents/contract-service';

export async function generateClientPortalInvoicePdf(invoiceId: string) {
  const session = await getClientPortalSession();
  const invoice = await getClientPortalInvoice(invoiceId);
  const branding = await getBrandingForOrganization(session.organizationId);

  const payload: InvoiceResponse = {
    id: invoice.id,
    organizationId: session.organizationId,
    clientId: session.contactId,
    projectId: null,
    project: null,
    number: invoice.number,
    title: invoice.title,
    status: invoice.status,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    createdAt: invoice.createdAt,
    updatedAt: invoice.createdAt,
    notes: null,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    creator: null,
    updater: null,
    payments: [],
    client: {
      id: session.contactId,
      firstName: session.contactName,
      lastName: '',
    },
    items: invoice.items.map((it) => ({
      id: it.id,
      invoiceId: invoice.id,
      description: it.description,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      amount: it.amount,
      taxRate: '0.00',
      createdAt: invoice.createdAt,
    })),
  };

  const pdfBuffer = await generateInvoicePdf(payload, {
    brandName: branding.brandName,
    brandColor: branding.brandColor,
    logoUrl: branding.logoUrl,
  });

  return {
    pdfBuffer,
    number: invoice.number,
  };
}

export async function generateClientPortalProposalPdf(proposalId: string) {
  const session = await getClientPortalSession();
  const proposal = await getClientPortalProposal(proposalId);
  const branding = await getBrandingForOrganization(session.organizationId);

  const payload: ProposalResponse = {
    id: proposal.id,
    organizationId: session.organizationId,
    opportunityId: null,
    contactId: session.contactId,
    number: proposal.number,
    title: proposal.title,
    status: proposal.status,
    subtotal: proposal.subtotal,
    tax: proposal.tax,
    total: proposal.total,
    currency: proposal.currency,
    validUntil: proposal.validUntil,
    notes: null,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: proposal.createdAt,
    updatedAt: proposal.createdAt,
    creator: null,
    updater: null,
    opportunity: null,
    contact: {
      id: session.contactId,
      firstName: session.contactName,
      lastName: '',
    },
    items: proposal.items.map(
      (it: {
        id: string;
        description: string;
        quantity: string;
        unitPrice: string;
        amount: string;
      }) => ({
        id: it.id,
        proposalId: proposal.id,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRate: '0.00',
        amount: it.amount,
        sortOrder: 0,
        createdAt: proposal.createdAt,
      })
    ),
  };

  const pdfBuffer = await generateProposalPdf(payload, {
    brandName: branding.brandName,
    brandColor: branding.brandColor,
    logoUrl: branding.logoUrl,
  });

  return {
    pdfBuffer,
    number: proposal.number,
  };
}

export async function generateClientPortalQuotationPdf(quotationId: string) {
  const session = await getClientPortalSession();
  const quotation = await getClientPortalQuotation(quotationId);
  const branding = await getBrandingForOrganization(session.organizationId);

  const payload: QuotationResponse = {
    id: quotation.id,
    organizationId: session.organizationId,
    opportunityId: null,
    contactId: session.contactId,
    number: quotation.number,
    title: quotation.title,
    status: quotation.status,
    subtotal: quotation.subtotal,
    tax: quotation.tax,
    total: quotation.total,
    currency: quotation.currency,
    validUntil: quotation.validUntil,
    notes: null,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: quotation.createdAt,
    updatedAt: quotation.createdAt,
    creator: null,
    updater: null,
    opportunity: null,
    contact: {
      id: session.contactId,
      firstName: session.contactName,
      lastName: '',
    },
    items: quotation.items.map(
      (it: {
        id: string;
        description: string;
        quantity: string;
        unitPrice: string;
        amount: string;
      }) => ({
        id: it.id,
        quotationId: quotation.id,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRate: '0.00',
        amount: it.amount,
        sortOrder: 0,
        createdAt: quotation.createdAt,
      })
    ),
  };

  const pdfBuffer = await generateQuotationPdf(payload, {
    brandName: branding.brandName,
    brandColor: branding.brandColor,
    logoUrl: branding.logoUrl,
  });

  return {
    pdfBuffer,
    number: quotation.number,
  };
}

export async function generateClientPortalContractPdf(contractId: string) {
  const session = await getClientPortalSession();
  const contract = await getClientPortalContract(contractId);
  const branding = await getBrandingForOrganization(session.organizationId);

  const payload: ContractResponse = {
    id: contract.id,
    organizationId: session.organizationId,
    proposalId: contract.proposalId,
    projectId: contract.projectId,
    title: contract.title,
    status: contract.status,
    signatureReference: contract.signatureReference,
    signedAt: contract.signedAt,
    signedBy: null,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    proposal: null,
    project: null,
    signer: null,
    signatures: contract.signatures.map(
      (s: {
        id: string;
        signerName: string;
        signerEmail: string;
        signedAt: Date;
        signatureMethod: string;
        signatureReference: string | null;
      }) => ({
        id: s.id,
        signerName: s.signerName,
        signerEmail: s.signerEmail,
        signedAt: s.signedAt,
        signatureMethod: s.signatureMethod,
        signatureReference: s.signatureReference,
      })
    ),
  };

  const pdfBuffer = await generateContractPdf(payload, {
    brandName: branding.brandName,
    brandColor: branding.brandColor,
    logoUrl: branding.logoUrl,
  });

  return {
    pdfBuffer,
    number: `CTR-${contract.id.slice(-6).toUpperCase()}`,
  };
}
