/**
 * AgencyOS Sales Proposal Builder Edit page (dynamic route).
 *
 * Server component: validates auth, loads existing proposal by ID,
 * contacts and opportunities, then renders the Proposal builder in edit
 * mode with saved values and line items pre-populated.
 *
 * Route: /sales/proposals/builder/[id]
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getProposal } from '@/lib/services/crm/proposal-service';
import { listContacts } from '@/lib/services/crm/contact-service';
import { listOpportunities } from '@/lib/services/crm/opportunity-service';
import { ProposalBuilderApp } from '../BuilderApp';

interface ContactOption {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

interface OpportunityOption {
  id: string;
  title: string;
}

interface BuilderEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProposalBuilderEditPage({ params }: BuilderEditPageProps) {
  const { id } = await params;

  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  // Load contacts, opportunities, and the existing proposal in parallel
  const [contactsResult, opportunitiesResult, existingProposal] = await Promise.all([
    listContacts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      includeDeleted: false,
    }).catch(() => ({
      contacts: [],
      total: 0,
      totalPages: 1,
    })),
    listOpportunities({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      includeDeleted: false,
    }).catch(() => ({
      opportunities: [],
      total: 0,
      totalPages: 1,
    })),
    getProposal(id).catch(() => null),
  ]);

  if (!existingProposal) {
    redirect('/sales/proposals');
  }

  const rawContacts = Array.isArray((contactsResult as { contacts: unknown[] }).contacts)
    ? ((contactsResult as { contacts: unknown[] }).contacts as unknown[])
    : [];
  const rawOpportunities = Array.isArray(
    (opportunitiesResult as { opportunities: unknown[] }).opportunities
  )
    ? ((opportunitiesResult as { opportunities: unknown[] }).opportunities as unknown[])
    : [];

  const contacts: ContactOption[] = rawContacts.map((c) => {
    const contact = c as Record<string, unknown>;
    return {
      id: String(contact.id),
      firstName: contact.firstName ? String(contact.firstName) : undefined,
      lastName: contact.lastName ? String(contact.lastName) : undefined,
      email: contact.email ? String(contact.email) : undefined,
    };
  });

  const opportunities: OpportunityOption[] = rawOpportunities.map((o) => {
    const opp = o as Record<string, unknown>;
    return {
      id: String(opp.id),
      title: String(opp.title),
    };
  });

  // Map ProposalResponse to local ProposalData shape
  const existingProposalData = {
    id: existingProposal.id,
    title: existingProposal.title,
    status: existingProposal.status,
    currency: existingProposal.currency,
    validUntil: existingProposal.validUntil
      ? existingProposal.validUntil.toISOString().slice(0, 10)
      : null,
    notes: existingProposal.notes,
    contactId: existingProposal.contactId,
    opportunityId: existingProposal.opportunityId,
    number: existingProposal.number,
    createdAt: existingProposal.createdAt ? existingProposal.createdAt.toISOString() : null,
    items: (existingProposal.items || []).map((item) => {
      const it = item as unknown as Record<string, unknown>;
      return {
        id: String(it.id),
        description: String(it.description),
        quantity: String(it.quantity ?? '1'),
        unitPrice: String(it.unitPrice ?? '0'),
        taxRate: String(it.taxRate ?? '0'),
        sortOrder: Number(it.sortOrder),
      };
    }),
  };

  return (
    <ProposalBuilderApp
      isEdit={true}
      proposalId={id}
      existingProposal={existingProposalData}
      initialContacts={contacts}
      initialOpportunities={opportunities}
    />
  );
}
