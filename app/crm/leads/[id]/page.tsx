import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { getLead } from '@/lib/services/crm/lead-service';
import { LeadDetailClient } from './lead-detail-client';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function LeadDetailPage({ params }: PageProps) {
  const cookieStore = await cookies();
  const sessionResult = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!sessionResult?.session || !sessionResult.user) {
    redirect('/login');
  }

  const { id } = await params;

  let lead;
  try {
    lead = await getLead(id);
  } catch {
    notFound();
  }

  if (!lead) {
    notFound();
  }

  const formattedLead = {
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
  };

  return (
    <div className="space-y-6 p-6">
      <LeadDetailClient lead={formattedLead} />
    </div>
  );
}
