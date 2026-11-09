/**
 * AgencyOS CRM Opportunity Edit page.
 * Server component that fetches the opportunity and renders the edit form.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getOpportunity } from '@/lib/services/crm/opportunity-service';
import { EditOpportunityForm } from './EditOpportunityForm';

export default async function OpportunityEditPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const opportunity = await getOpportunity(id);

  return <EditOpportunityForm opportunity={opportunity} />;
}
