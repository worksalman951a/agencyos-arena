/**
 * AgencyOS Finance Invoice New page.
 *
 * Server Component: resolves the clients that may be attached to the invoice
 * through the contact service (session + `contact.read` + organization scoping)
 * and renders the client form. Loading the contact list server-side removes the
 * "paste a contact CUID" field that made the client association unusable.
 */

import { listContacts } from '@/lib/services/crm/contact-service';
import { getFinancialDefaults } from '@/lib/services/settings/organization-service';
import { loadPageData } from '@/lib/page-data';
import { NewInvoiceForm } from './NewInvoiceForm';

export default async function NewInvoicePage() {
  // Organization financial defaults: the new invoice starts in the configured
  // currency and with the configured default tax rate. The currency stays
  // editable per document.
  const defaults = await getFinancialDefaults();

  const contactsResult = await loadPageData(() =>
    listContacts({
      page: 1,
      pageSize: 100,
      sortBy: 'firstName',
      sortOrder: 'asc',
      includeDeleted: false,
    })
  );

  // A caller without `contact.read` can still create an invoice; the client
  // association is optional, so degrade to an empty selector rather than
  // blocking the page.
  const contacts = contactsResult.ok
    ? contactsResult.data.contacts.map((contact) => ({
        id: contact.id,
        label:
          [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
          contact.email ||
          contact.id,
      }))
    : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">New Invoice</h1>
          <p className="text-sm text-muted-foreground">
            Draft an invoice with line items. Totals are calculated server-side.
          </p>
        </div>
      </div>

      <NewInvoiceForm
        contacts={contacts}
        defaultCurrency={defaults.defaultCurrency}
        defaultTaxRate={defaults.invoiceTaxDefault}
      />
    </div>
  );
}
