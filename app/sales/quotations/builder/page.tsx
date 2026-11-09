/**
 * AgencyOS Sales Quotation Builder page.
 *
 * Server component: validates auth, loads initial data (contacts,
 * opportunities, existing quotation if editing), then renders the client
 * builder component.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getQuotation } from '@/lib/services/crm/quotation-service';
import { listContacts } from '@/lib/services/crm/contact-service';
import { listOpportunities } from '@/lib/services/crm/opportunity-service';
import { QuotationBuilderApp } from './BuilderApp';

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

export default async function QuotationBuilderPage() {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  // Create-mode builder: this route has no dynamic segment, so there is no
  // route id to read. Editing lives at /sales/quotations/builder/[id].
  const id = '';
  const isEdit = Boolean(id);

  // Load contacts and opportunities for client selection
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
    isEdit ? getQuotation(id).catch(() => null) : null,
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

  // Map QuotationResponse to local QuotationData shape
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
  } | null = existingQuotation
    ? {
        id: existingQuotation.id,
        title: existingQuotation.title,
        status: existingQuotation.status,
        currency: existingQuotation.currency,
        validUntil: existingQuotation.validUntil
          ? existingQuotation.validUntil.toISOString()
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
      }
    : null;

  return (
    <QuotationBuilderApp
      isEdit={isEdit}
      quotationId={id ?? null}
      existingQuotation={existingQuotationLike}
      initialContacts={contacts}
      initialOpportunities={opportunities}
    />
  );
}
