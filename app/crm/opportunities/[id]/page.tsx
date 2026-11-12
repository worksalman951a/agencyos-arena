import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { getOpportunity } from '@/lib/services/crm/opportunity-service';
import { prisma } from '@/lib/db';
import { OpportunityDetailClient } from './opportunity-detail-client';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function OpportunityDetailPage({ params }: PageProps) {
  const cookieStore = await cookies();
  const sessionResult = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!sessionResult?.session || !sessionResult.user) {
    redirect('/login');
  }

  const { id } = await params;

  let opportunity;
  try {
    opportunity = await getOpportunity(id);
  } catch {
    notFound();
  }

  if (!opportunity) {
    notFound();
  }

  // Load linked proposals & quotations within the user's organization
  const [proposals, quotations] = await Promise.all([
    prisma.proposal.findMany({
      where: { opportunityId: id, organizationId: opportunity.organizationId },
      select: { id: true, number: true, title: true, status: true, total: true, currency: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.quotation.findMany({
      where: { opportunityId: id, organizationId: opportunity.organizationId },
      select: { id: true, number: true, title: true, status: true, total: true, currency: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const formattedOpportunity = {
    ...opportunity,
    proposals: proposals.map(
      (p: {
        id: string;
        number: string;
        title: string;
        status: string;
        total: unknown;
        currency: string;
      }) => ({ ...p, total: Number(p.total) })
    ),
    quotations: quotations.map(
      (q: {
        id: string;
        number: string;
        title: string;
        status: string;
        total: unknown;
        currency: string;
      }) => ({ ...q, total: Number(q.total) })
    ),
  };

  return (
    <div className="space-y-6 p-6">
      <OpportunityDetailClient opportunity={formattedOpportunity} />
    </div>
  );
}
