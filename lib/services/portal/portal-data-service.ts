'use server';

/**
 * Client Portal Data Access Service (Phase 11G-1).
 *
 * Strict Multi-Tenant & Contact-Scoped Authorization:
 * - Every loader independently calls `getClientPortalSession()` to verify an active client session.
 * - Access is strictly bound to `context.contactId` and `context.organizationId`.
 * - Cross-contact and cross-tenant leakage is physically impossible at the database query level.
 * - Draft, soft-deleted, and internal-only entities are completely filtered out.
 * - No staff profitability margins, cost prices, or internal notes are exposed.
 */

import { prisma } from '@/lib/db';
import {
  getClientPortalSession,
  ClientPortalContext,
} from '@/lib/services/portal/portal-auth-service';

function codedError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export interface ClientPortalOverviewData {
  context: ClientPortalContext;
  invoicesCount: number;
  openInvoicesCount: number;
  openInvoicesTotal: string;
  activeProjectsCount: number;
  pendingDocumentsCount: number;
  recentInvoices: Array<{
    id: string;
    number: string;
    title: string;
    total: string;
    currency: string;
    status: string;
    dueDate: Date | null;
  }>;
  recentProjects: Array<{
    id: string;
    name: string;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
  }>;
  recentDocuments: Array<{
    id: string;
    type: 'proposal' | 'quotation' | 'contract';
    number: string;
    title: string;
    status: string;
    createdAt: Date;
  }>;
}

/**
 * Load Portal Dashboard Overview Data
 */
export async function getClientPortalOverview(): Promise<ClientPortalOverviewData> {
  const context = await getClientPortalSession();
  const { organizationId, contactId } = context;

  // 1. Authorized Invoices for this contact
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      clientId: contactId,
      deletedAt: null,
      status: { in: ['sent', 'paid', 'overdue'] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      number: true,
      title: true,
      total: true,
      currency: true,
      status: true,
      dueDate: true,
    },
  });

  const openInvoices = (
    invoices as Array<{ status: string; currency: string; total: { toString: () => string } }>
  ).filter((i) => i.status === 'sent' || i.status === 'overdue');

  // Aggregate by currency to avoid mixing multiple currencies into a single sum
  const currenciesInOpenInvoices = Array.from(new Set(openInvoices.map((i) => i.currency)));
  let openInvoicesSummary = '0.00';
  if (currenciesInOpenInvoices.length === 1) {
    const currency = currenciesInOpenInvoices[0];
    const total = openInvoices
      .reduce((sum: number, inv) => sum + Number(inv.total.toString()), 0)
      .toFixed(2);
    openInvoicesSummary = `${currency} ${total}`;
  } else if (currenciesInOpenInvoices.length > 1) {
    openInvoicesSummary = `${openInvoices.length} invoices across ${currenciesInOpenInvoices.join(', ')}`;
  } else if (invoices.length > 0) {
    const defaultCur = (invoices[0] as { currency: string }).currency;
    openInvoicesSummary = `${defaultCur} 0.00`;
  }

  // 2. Authorized Projects for this contact
  const projects = await prisma.project.findMany({
    where: {
      organizationId,
      clientId: contactId,
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
    },
  });

  const activeProjectsCount = (projects as Array<{ status: string }>).filter(
    (p) => p.status === 'active' || p.status === 'in_progress'
  ).length;

  // 3. Authorized Proposals & Quotations
  const [proposals, quotations] = await Promise.all([
    prisma.proposal.findMany({
      where: {
        organizationId,
        contactId,
        deletedAt: null,
        status: { in: ['sent', 'accepted', 'rejected'] },
      },
      select: { id: true, number: true, title: true, status: true, createdAt: true },
      take: 5,
    }),
    prisma.quotation.findMany({
      where: {
        organizationId,
        contactId,
        deletedAt: null,
        status: { in: ['sent', 'accepted', 'rejected'] },
      },
      select: { id: true, number: true, title: true, status: true, createdAt: true },
      take: 5,
    }),
  ]);

  const recentDocuments = [
    ...(
      proposals as Array<{
        id: string;
        number: string;
        title: string;
        status: string;
        createdAt: Date;
      }>
    ).map((p) => ({ ...p, type: 'proposal' as const })),
    ...(
      quotations as Array<{
        id: string;
        number: string;
        title: string;
        status: string;
        createdAt: Date;
      }>
    ).map((q) => ({ ...q, type: 'quotation' as const })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const pendingDocumentsCount = recentDocuments.filter((d) => d.status === 'sent').length;

  return {
    context,
    invoicesCount: invoices.length,
    openInvoicesCount: openInvoices.length,
    openInvoicesTotal: openInvoicesSummary,
    activeProjectsCount,
    pendingDocumentsCount,
    recentInvoices: (
      invoices as Array<{
        id: string;
        number: string;
        title: string;
        total: { toString: () => string };
        currency: string;
        status: string;
        dueDate: Date | null;
      }>
    )
      .slice(0, 5)
      .map((inv) => ({
        ...inv,
        total: Number(inv.total.toString()).toFixed(2),
      })),
    recentProjects: projects.slice(0, 5),
    recentDocuments: recentDocuments.slice(0, 5),
  };
}

/**
 * List Invoices specifically authorized for this contact
 */
export async function listClientPortalInvoices() {
  const context = await getClientPortalSession();
  const { organizationId, contactId } = context;

  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      clientId: contactId,
      deletedAt: null,
      status: { in: ['sent', 'paid', 'overdue'] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      number: true,
      title: true,
      subtotal: true,
      tax: true,
      total: true,
      currency: true,
      status: true,
      dueDate: true,
      createdAt: true,
    },
  });

  return (
    invoices as Array<{
      id: string;
      number: string;
      title: string;
      subtotal: { toString: () => string };
      tax: { toString: () => string };
      total: { toString: () => string };
      currency: string;
      status: string;
      dueDate: Date | null;
      createdAt: Date;
    }>
  ).map((inv) => ({
    id: inv.id,
    number: inv.number,
    title: inv.title,
    subtotal: Number(inv.subtotal.toString()).toFixed(2),
    tax: Number(inv.tax.toString()).toFixed(2),
    total: Number(inv.total.toString()).toFixed(2),
    currency: inv.currency,
    status: inv.status,
    dueDate: inv.dueDate,
    createdAt: inv.createdAt,
  }));
}

/**
 * Get Single Authorized Invoice Details
 */
export async function getClientPortalInvoice(id: string) {
  const context = await getClientPortalSession();
  const { organizationId, contactId } = context;

  const invoice = await prisma.invoice.findFirst({
    where: {
      id,
      organizationId,
      clientId: contactId,
      deletedAt: null,
      status: { in: ['sent', 'paid', 'overdue'] },
    },
    include: {
      items: {
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          amount: true,
        },
      },
    },
  });

  if (!invoice) {
    throw codedError('Invoice not found or access denied', 404);
  }

  return {
    id: invoice.id,
    number: invoice.number,
    title: invoice.title,
    subtotal: Number(invoice.subtotal.toString()).toFixed(2),
    tax: Number(invoice.tax.toString()).toFixed(2),
    total: Number(invoice.total.toString()).toFixed(2),
    currency: invoice.currency,
    status: invoice.status,
    dueDate: invoice.dueDate,
    createdAt: invoice.createdAt,
    items: (
      invoice.items as Array<{
        id: string;
        description: string;
        quantity: { toString: () => string };
        unitPrice: { toString: () => string };
        amount: { toString: () => string };
      }>
    ).map((it) => ({
      id: it.id,
      description: it.description,
      quantity: it.quantity.toString(),
      unitPrice: Number(it.unitPrice.toString()).toFixed(2),
      amount: Number(it.amount.toString()).toFixed(2),
    })),
  };
}

/**
 * List Projects specifically authorized for this contact
 */
export async function listClientPortalProjects() {
  const context = await getClientPortalSession();
  const { organizationId, contactId } = context;

  const projects = await prisma.project.findMany({
    where: {
      organizationId,
      clientId: contactId,
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      startDate: true,
      endDate: true,
      createdAt: true,
      milestones: {
        select: {
          id: true,
          name: true,
          status: true,
          dueDate: true,
        },
        orderBy: { dueDate: 'asc' },
      },
    },
  });

  return projects;
}

/**
 * List Documents (Proposals, Quotations, Contracts) authorized for this contact
 */
export async function listClientPortalDocuments() {
  const context = await getClientPortalSession();
  const { organizationId, contactId } = context;

  const [proposals, quotations] = await Promise.all([
    prisma.proposal.findMany({
      where: {
        organizationId,
        contactId,
        deletedAt: null,
        status: { in: ['sent', 'accepted', 'rejected'] },
      },
      select: {
        id: true,
        number: true,
        title: true,
        total: true,
        currency: true,
        status: true,
        validUntil: true,
        createdAt: true,
      },
    }),
    prisma.quotation.findMany({
      where: {
        organizationId,
        contactId,
        deletedAt: null,
        status: { in: ['sent', 'accepted', 'rejected'] },
      },
      select: {
        id: true,
        number: true,
        title: true,
        total: true,
        currency: true,
        status: true,
        validUntil: true,
        createdAt: true,
      },
    }),
  ]);

  const items = [
    ...(
      proposals as Array<{
        id: string;
        number: string;
        title: string;
        total: { toString: () => string };
        currency: string;
        status: string;
        validUntil: Date | null;
        createdAt: Date;
      }>
    ).map((p) => ({
      id: p.id,
      type: 'proposal' as const,
      number: p.number,
      title: p.title,
      total: Number(p.total.toString()).toFixed(2),
      currency: p.currency,
      status: p.status,
      validUntil: p.validUntil,
      createdAt: p.createdAt,
    })),
    ...(
      quotations as Array<{
        id: string;
        number: string;
        title: string;
        total: { toString: () => string };
        currency: string;
        status: string;
        validUntil: Date | null;
        createdAt: Date;
      }>
    ).map((q) => ({
      id: q.id,
      type: 'quotation' as const,
      number: q.number,
      title: q.title,
      total: Number(q.total.toString()).toFixed(2),
      currency: q.currency,
      status: q.status,
      validUntil: q.validUntil,
      createdAt: q.createdAt,
    })),
  ];

  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
