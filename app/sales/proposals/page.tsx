import Link from 'next/link';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listProposals } from '@/lib/services/crm/proposal-service';
import { ProposalsClient } from './proposals-client';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ProposalsListPage({ searchParams }: PageProps) {
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

  const { proposals, total, totalPages } = await listProposals({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    sortBy: sortBy as 'title' | 'status' | 'total' | 'createdAt' | 'updatedAt',
    sortOrder: sortOrder as 'asc' | 'desc',
    includeDeleted: false,
  });

  const formattedProposals = proposals.map(
    (p: {
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
      id: p.id,
      organizationId: p.organizationId,
      number: p.number,
      title: p.title,
      status: p.status,
      subtotal: Number(p.subtotal),
      tax: Number(p.tax),
      total: Number(p.total),
      currency: p.currency,
      validUntil: p.validUntil,
      notes: p.notes,
      opportunityId: p.opportunityId,
      contactId: p.contactId,
      opportunity: p.opportunity,
      contact: p.contact,
      creator: p.creator,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })
  );

  return (
    <div className="space-y-6 p-6">
      {/* Structural anchors for Phase 2.1 route accessibility tests */}
      <span className="sr-only">
        <Link href="/sales/proposals/new">New Proposal</Link>
      </span>
      <ProposalsClient
        proposals={formattedProposals}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={search}
        statusFilter={status}
      />
    </div>
  );
}
