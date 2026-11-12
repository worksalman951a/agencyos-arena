import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listLeads } from '@/lib/services/crm/lead-service';
import { LeadsClient } from './leads-client';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function LeadsPage({ searchParams }: PageProps) {
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
  const priority = String(resolvedParams.priority ?? '');

  const { leads, total, totalPages } = await listLeads({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    priority: priority || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    includeDeleted: false,
  });

  const formattedLeads = leads.map(
    (lead: {
      id: string;
      organizationId: string;
      source: string;
      status: string;
      priority: string | null;
      expectedValue: string | null;
      contactId: string | null;
      accountId: string | null;
      ownerId: string | null;
      pipelineId: string | null;
      stageId: string | null;
      notes: string | null;
      isDuplicate?: boolean;
      duplicateId?: string | null;
      contact: { id: string; firstName: string | null; lastName: string } | null;
      account: { id: string; name: string } | null;
      convertedOpportunity: {
        id: string;
        title: string;
        status: string;
        value: string | null;
        currency: string;
        createdAt: Date;
      } | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }) => ({
      id: lead.id,
      organizationId: lead.organizationId,
      source: lead.source,
      status: lead.status,
      priority: lead.priority,
      expectedValue: lead.expectedValue,
      contactId: lead.contactId,
      accountId: lead.accountId,
      ownerId: lead.ownerId,
      pipelineId: lead.pipelineId,
      stageId: lead.stageId,
      notes: lead.notes,
      isDuplicate: lead.isDuplicate,
      duplicateId: lead.duplicateId,
      contact: lead.contact,
      account: lead.account,
      convertedOpportunity: lead.convertedOpportunity,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      deletedAt: lead.deletedAt,
    })
  );

  return (
    <div className="space-y-6 p-6">
      <LeadsClient
        leads={formattedLeads}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={search}
        statusFilter={status}
        priorityFilter={priority}
      />
    </div>
  );
}
