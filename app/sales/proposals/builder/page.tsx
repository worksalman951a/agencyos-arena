/**
 * AgencyOS Sales Proposal Builder page.
 *
 * Server component: validates auth, loads initial data (contacts,
 * opportunities, existing proposal if editing), then renders the client
 * builder component.
 */

import { auth } from '@/lib/auth-server';
import { getFinancialDefaults } from '@/lib/services/settings/organization-service';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getProposal } from '@/lib/services/crm/proposal-service';
import { listContacts } from '@/lib/services/crm/contact-service';
import { listOpportunities } from '@/lib/services/crm/opportunity-service';
import { ProposalBuilderApp } from './BuilderApp';

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

export default async function ProposalBuilderPage() {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  // Create-mode builder: this route has no dynamic segment, so there is no
  // route id to read. Editing lives at /sales/proposals/builder/[id].
  const id = '';
  const isEdit = Boolean(id);

  // Load contacts and opportunities for client selection
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
    isEdit ? getProposal(id).catch(() => null) : null,
  ]);

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
  const existingQuotationLike: {
    id: string;
    title: string;
    status: string;
    currency: string;
    validUntil: string | null;
    notes: string | null;
    contactId: string | null;
    opportunityId: string | null;
    number: string;
    createdAt: string | null;
    items: Array<{
      id: string;
      description: string;
      quantity: number | string;
      unitPrice: number | string;
      taxRate: number | string;
      sortOrder: number;
    }>;
  } | null = existingProposal
    ? {
        id: existingProposal.id,
        title: existingProposal.title,
        status: existingProposal.status,
        currency: existingProposal.currency,
        validUntil: existingProposal.validUntil ? existingProposal.validUntil.toISOString() : null,
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
      }
    : null;

  // Organization defaults: a new document starts in the configured currency.
  const financialDefaults = await getFinancialDefaults();

  return (
    <ProposalBuilderApp
      isEdit={isEdit}
      proposalId={id ?? null}
      existingProposal={existingQuotationLike}
      initialContacts={contacts}
      initialOpportunities={opportunities}
      defaultCurrency={financialDefaults.defaultCurrency}
    />
  );
}
