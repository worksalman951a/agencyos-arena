/**
 * AgencyOS Sales Quotation Builder Edit page (dynamic route).
 *
 * Server component: validates auth, loads existing quotation by ID,
 * contacts and opportunities, then renders the Quotation builder in edit
 * mode with saved values and line items pre-populated.
 *
 * Route: /sales/quotations/builder/[id]
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getQuotation } from '@/lib/services/crm/quotation-service';
import { listContacts } from '@/lib/services/crm/contact-service';
import { listOpportunities } from '@/lib/services/crm/opportunity-service';
import { QuotationBuilderApp } from '../BuilderApp';

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

export default async function QuotationBuilderEditPage({ params }: BuilderEditPageProps) {
  const { id } = await params;

  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  // Load contacts, opportunities, and the existing quotation in parallel
  const [contactsResult, opportunitiesResult, existingQuotation] = await Promise.all([
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
    getQuotation(id).catch(() => null),
  ]);

  if (!existingQuotation) {
    redirect('/sales/quotations');
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

  // Map QuotationResponse to local QuotationData shape
  const existingQuotationData = {
    id: existingQuotation.id,
    title: existingQuotation.title,
    status: existingQuotation.status,
    currency: existingQuotation.currency,
    validUntil: existingQuotation.validUntil
      ? existingQuotation.validUntil.toISOString().slice(0, 10)
      : null,
    notes: existingQuotation.notes,
    contactId: existingQuotation.contactId,
    opportunityId: existingQuotation.opportunityId,
    number: existingQuotation.number,
    createdAt: existingQuotation.createdAt ? existingQuotation.createdAt.toISOString() : null,
    items: (existingQuotation.items || []).map((item) => {
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
    <QuotationBuilderApp
      isEdit={true}
      quotationId={id}
      existingQuotation={existingQuotationData}
      initialContacts={contacts}
      initialOpportunities={opportunities}
    />
  );
}
