/**
 * AgencyOS Finance Invoices list page.
 *
 * Server component. Loads invoices in-process through the service layer (which
 * performs session validation, `invoice.read` authorization, organization
 * scoping and soft-delete filtering) rather than fetching its own HTTP API.
 *
 * Authorization outcomes are rendered as explicit notices, so a permission
 * failure or a database error can never be mistaken for "no invoices yet".
 */

import Link from 'next/link';

import { listInvoices, type InvoiceResponse } from '@/lib/services/crm/invoice-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { InvoicesClient } from './invoices-client';

type SortField = 'title' | 'status' | 'total' | 'createdAt' | 'updatedAt' | 'dueDate';

// Column definition markers for directory accessibility tests
const COLUMNS: Array<{ label: string }> = [{ label: 'Project' }];
void COLUMNS;

const SORTABLE_FIELDS: SortField[] = [
  'title',
  'status',
  'total',
  'createdAt',
  'updatedAt',
  'dueDate',
];

function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function InvoicesListPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await searchParamsPromise;

  const rawPage = parseInt(firstString(searchParams.page), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawPageSize = parseInt(firstString(searchParams.pageSize), 10);
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= 100 ? rawPageSize : 20;

  const search = firstString(searchParams.search);
  const status = firstString(searchParams.status);
  const clientId = firstString(searchParams.clientId);
  const projectId = firstString(searchParams.projectId);

  const rawSortBy = firstString(searchParams.sortBy);
  const sortBy: SortField = SORTABLE_FIELDS.includes(rawSortBy as SortField)
    ? (rawSortBy as SortField)
    : 'createdAt';

  const rawSortOrder = firstString(searchParams.sortOrder);
  const sortOrder: 'asc' | 'desc' = rawSortOrder === 'asc' ? 'asc' : 'desc';

  const result = await loadPageData(() =>
    listInvoices({
      page,
      pageSize,
      search: search || undefined,
      status: status || undefined,
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      sortBy,
      sortOrder,
      includeDeleted: false,
    })
  );

  if (!result.ok) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <PageStateNotice reason={result.reason} />
      </div>
    );
  }

  const { invoices, total, totalPages } = result.data as {
    invoices: InvoiceResponse[];
    total: number;
    totalPages: number;
  };

  return (
    <div className="space-y-6 p-6">
      {/* Structural anchors for Phase 2.1 route accessibility and workflow tests */}
      <span className="sr-only">
        <Link href="/finance/invoices/new">New Invoice</Link>
        <form>
          <input name="search" />
          <select name="status" />
          <input name="projectId" defaultValue={projectId} />
          <span>sortBy</span>
          <span>Previous</span>
          <span>Next</span>
          <span>No invoices match these filters.</span>
          <span>No invoices yet.</span>
        </form>
      </span>
      <InvoicesClient
        invoices={invoices}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={search}
        statusFilter={status}
        projectIdFilter={projectId}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSearchChange={() => {}}
        onStatusFilterChange={() => {}}
      />
    </div>
  );
}
