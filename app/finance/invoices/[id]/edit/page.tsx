/**
 * AgencyOS Finance Invoice Edit page.
 *
 * Server Component. Loads the invoice through the service layer and checks — in
 * this order — the session, `invoice.read`, the invoice's editability and
 * `invoice.update` before rendering the form. Previously this page fetched its
 * own API from the browser, showed "Loading invoice…" forever when the request
 * failed, and offered an edit form for paid/voided invoices whose save could
 * only fail.
 *
 * Status choices are limited to the transitions the service accepts, so the
 * form can never request an illegal state change.
 */

import Link from 'next/link';

import { getInvoice } from '@/lib/services/crm/invoice-service';
import { listContacts } from '@/lib/services/crm/contact-service';
import { getCurrentPermissions } from '@/lib/current-user';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { EditInvoiceForm, type EditableInvoice } from './EditInvoiceForm';

/** Mirrors VALID_TRANSITIONS in the invoice service. */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'paid', 'voided'],
  sent: ['paid', 'voided'],
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  voided: 'Voided',
};

function EditBlocked({ title, message }: { title: string; message: string }) {
  return (
    <div className="p-6">
      <div
        role="alert"
        className="max-w-xl rounded-lg border border-amber-300/60 bg-amber-50 p-6 dark:bg-amber-950/30"
      >
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Link
          href="/finance/invoices"
          className="mt-4 inline-block text-sm text-accent hover:underline"
        >
          Back to invoices
        </Link>
      </div>
    </div>
  );
}

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await loadPageData(() => getInvoice(id));

  if (!result.ok) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-bold">Edit Invoice</h1>
        <PageStateNotice
          reason={result.reason}
          backHref="/finance/invoices"
          backLabel="Back to invoices"
        />
      </div>
    );
  }

  const invoice = result.data;
  const permissions = await getCurrentPermissions();

  if (!permissions.has('invoice.update')) {
    return (
      <EditBlocked
        title="You do not have permission to edit invoices"
        message="Your role can view this invoice but not change it. An administrator can grant the invoice.update permission."
      />
    );
  }

  const allowedTransitions = STATUS_TRANSITIONS[invoice.status];
  if (!allowedTransitions) {
    return (
      <EditBlocked
        title={`Invoice ${invoice.number} can no longer be edited`}
        message={`Only draft and sent invoices can be modified. This invoice is ${invoice.status}.`}
      />
    );
  }

  const contactsResult = await loadPageData(() =>
    listContacts({
      page: 1,
      pageSize: 100,
      sortBy: 'firstName',
      sortOrder: 'asc',
      includeDeleted: false,
    })
  );

  // Contacts are only needed for the client selector; if the caller cannot read
  // them the invoice can still be edited (a client change is optional).
  const contacts = contactsResult.ok
    ? contactsResult.data.contacts.map((contact) => ({
        id: contact.id,
        label:
          [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
          contact.email ||
          contact.id,
      }))
    : [];

  const statusOptions = [invoice.status, ...allowedTransitions].map((value) => ({
    value,
    label: STATUS_LABELS[value] ?? value,
  }));

  const editable: EditableInvoice = {
    id: invoice.id,
    number: invoice.number,
    title: invoice.title,
    status: invoice.status,
    currency: invoice.currency,
    dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString() : null,
    notes: invoice.notes,
    clientId: invoice.clientId,
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
    })),
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit Invoice {invoice.number}</h1>
        <Link
          href={`/finance/invoices/${invoice.id}`}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      <EditInvoiceForm invoice={editable} contacts={contacts} statusOptions={statusOptions} />
    </div>
  );
}
