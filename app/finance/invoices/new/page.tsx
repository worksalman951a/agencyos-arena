/**
 * AgencyOS Finance Invoice New page.
 *
 * Server Component: resolves the clients that may be attached to the invoice
 * through the contact service (session + `contact.read` + organization scoping)
 * and renders the client form. Loading the contact list server-side removes the
 * "paste a contact CUID" field that made the client association unusable.
 *
 * Project handoff (Phase 5A): `/finance/invoices/new?projectId=<id>` is how a
 * project workspace starts an invoice. The id is only honoured when it is one
 * of the projects the project service returns for this caller (session +
 * `project.read` + organization scoping, not archived, not deleted). Anything
 * else - another tenant's id, an archived project, a caller who cannot read
 * projects - gets the same neutral notice and no preselection. The invoice API
 * validates the project again on submit.
 */

import Link from 'next/link';

import { listContacts } from '@/lib/services/crm/contact-service';
import { listProjectOptions } from '@/lib/services/crm/project-service';
import { getFinancialDefaults } from '@/lib/services/settings/organization-service';
import { loadPageData } from '@/lib/page-data';
import { NewInvoiceForm } from './NewInvoiceForm';

export default async function NewInvoicePage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await searchParamsPromise;
  const rawProjectId = searchParams.projectId;
  const requestedProjectId = (Array.isArray(rawProjectId) ? rawProjectId[0] : rawProjectId) ?? '';

  // Organization financial defaults: the new invoice starts in the configured
  // currency and with the configured default tax rate. The currency stays
  // editable per document.
  const defaults = await getFinancialDefaults();

  const [contactsResult, projectsResult] = await Promise.all([
    loadPageData(() =>
      listContacts({
        page: 1,
        pageSize: 100,
        sortBy: 'firstName',
        sortOrder: 'asc',
        includeDeleted: false,
      })
    ),
    // Linking a project is optional as well: without `project.read` the
    // selector is simply empty.
    loadPageData(() => listProjectOptions()),
  ]);

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

  const projects = projectsResult.ok ? projectsResult.data : [];
  const handoffProject = projects.find((project) => project.id === requestedProjectId);
  const handoffClientId =
    handoffProject?.clientId && contacts.some((c) => c.id === handoffProject.clientId)
      ? handoffProject.clientId
      : '';

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">New Invoice</h1>
          <p className="text-sm text-muted-foreground">
            Draft an invoice with line items. Totals are calculated server-side.
          </p>
        </div>
        {handoffProject ? (
          <Link
            href={`/projects/${handoffProject.id}`}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to project
          </Link>
        ) : null}
      </div>

      {handoffProject ? (
        <p
          data-testid="invoice-project-handoff"
          className="max-w-2xl rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          This invoice will be linked to project{' '}
          <span className="font-medium">{handoffProject.name}</span>. You can change or clear the
          project below.
        </p>
      ) : requestedProjectId ? (
        <p
          role="alert"
          data-testid="invoice-project-unavailable"
          className="max-w-2xl rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30"
        >
          The requested project is not available for invoicing. It may be archived, deleted or
          outside your access. No project has been preselected.
        </p>
      ) : null}

      <NewInvoiceForm
        contacts={contacts}
        projects={projects.map((project) => ({ id: project.id, label: project.name }))}
        defaultProjectId={handoffProject?.id ?? ''}
        defaultClientId={handoffClientId}
        defaultCurrency={defaults.defaultCurrency}
        defaultTaxRate={defaults.invoiceTaxDefault}
      />
    </div>
  );
}
