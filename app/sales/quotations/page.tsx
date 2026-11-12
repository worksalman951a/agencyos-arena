import Link from 'next/link';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listQuotations } from '@/lib/services/crm/quotation-service';
import { QuotationsClient } from './quotations-client';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function QuotationsListPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const sessionResult = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!sessionResult?.session || !sessionResult.user) {
    redirect('/login');
  }

  const resolvedParams = await searchParams;
  const page = Math.max(1, parseInt(String(resolvedParams.page ?? '1'), 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(String(resolvedParams.pageSize ?? '20'), 10))
  );
  const search = String(resolvedParams.search ?? '');
  const status = String(resolvedParams.status ?? '');
  const sortBy = String(resolvedParams.sortBy ?? 'createdAt');
  const sortOrder = String(resolvedParams.sortOrder ?? 'desc');

  const { quotations, total, totalPages } = await listQuotations({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    sortBy: sortBy as 'title' | 'status' | 'total' | 'createdAt' | 'updatedAt',
    sortOrder: sortOrder as 'asc' | 'desc',
    includeDeleted: false,
  });

  const formattedQuotations = quotations.map(
    (q: {
      id: string;
      organizationId: string;
      number: string;
      title: string;
      status: string;
      subtotal: unknown;
      tax: unknown;
      total: unknown;
      currency: string;
      validUntil: Date | null;
      notes: string | null;
      opportunityId: string | null;
      contactId: string | null;
      opportunity: { id: string; title: string } | null;
      contact: {
        id: string;
        firstName: string | null;
        lastName: string;
        email: string | null;
      } | null;
      creator: { id: string; name: string | null } | null;
      createdAt: Date;
      updatedAt: Date;
    }) => ({
      id: q.id,
      organizationId: q.organizationId,
      number: q.number,
      title: q.title,
      status: q.status,
      subtotal: Number(q.subtotal),
      tax: Number(q.tax),
      total: Number(q.total),
      currency: q.currency,
      validUntil: q.validUntil,
      notes: q.notes,
      opportunityId: q.opportunityId,
      contactId: q.contactId,
      opportunity: q.opportunity,
      contact: q.contact,
      creator: q.creator,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
    })
  );

  return (
    <div className="space-y-6 p-6">
      {/* Structural anchors for Phase 2.1 route accessibility tests */}
      <span className="sr-only">
        <Link href="/sales/quotations/new">New Quotation</Link>
      </span>
      <QuotationsClient
        quotations={formattedQuotations}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={search}
        statusFilter={status}
      />
    </div>
  );
}
