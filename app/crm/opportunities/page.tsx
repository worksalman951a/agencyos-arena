import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listOpportunities } from '@/lib/services/crm/opportunity-service';
import { OpportunitiesClient } from './opportunities-client';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function OpportunitiesPage({ searchParams }: PageProps) {
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

  const { opportunities, total, totalPages } = await listOpportunities({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    includeDeleted: false,
  });

  const formattedOpportunities = opportunities.map(
    (opp: {
      id: string;
      organizationId: string;
      contactId: string | null;
      accountId: string | null;
      leadId: string | null;
      pipelineId: string | null;
      stageId: string | null;
      title: string;
      description: string | null;
      value: string | null;
      currency: string;
      closeDate: Date | null;
      ownerId: string | null;
      status: string;
      probability: string | null;
      lossReason: string | null;
      contact: { id: string; firstName: string | null; lastName: string } | null;
      account: { id: string; name: string } | null;
      lead: { id: string; source: string; status: string } | null;
      pipeline: { id: string; name: string } | null;
      stage: { id: string; name: string; isWon: boolean; isLost: boolean } | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }) => ({
      id: opp.id,
      organizationId: opp.organizationId,
      contactId: opp.contactId,
      accountId: opp.accountId,
      leadId: opp.leadId,
      pipelineId: opp.pipelineId,
      stageId: opp.stageId,
      title: opp.title,
      description: opp.description,
      value: opp.value,
      currency: opp.currency,
      closeDate: opp.closeDate,
      ownerId: opp.ownerId,
      status: opp.status,
      probability: opp.probability,
      lossReason: opp.lossReason,
      contact: opp.contact,
      account: opp.account,
      lead: opp.lead,
      pipeline: opp.pipeline,
      stage: opp.stage,
      createdAt: opp.createdAt,
      updatedAt: opp.updatedAt,
      deletedAt: opp.deletedAt,
    })
  );

  return (
    <div className="space-y-6 p-6">
      <OpportunitiesClient
        opportunities={formattedOpportunities}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={search}
        statusFilter={status}
      />
    </div>
  );
}
