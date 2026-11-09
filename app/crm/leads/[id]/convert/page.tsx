/**
 * AgencyOS CRM Lead-to-Opportunity Conversion page.
 * Server component that fetches the lead and renders the conversion form.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLead } from '@/lib/services/crm/lead-service';
import { ConvertForm } from './ConvertForm';

export default async function ConvertPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const lead = await getLead(id);

  return <ConvertForm leadId={id} lead={lead} />;
}
