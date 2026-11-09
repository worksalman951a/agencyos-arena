/**
 * AgencyOS CRM Lead Edit page.
 * Server component that fetches the lead and renders the edit form.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLead } from '@/lib/services/crm/lead-service';
import { EditLeadForm } from './EditLeadForm';

export default async function LeadEditPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const lead = await getLead(id);

  return <EditLeadForm lead={lead} />;
}
