/**
 * AgencyOS CRM Pipeline Edit page.
 * Server component that fetches the pipeline and renders the edit form.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPipeline } from '@/lib/services/crm/pipeline-service';
import { EditPipelineForm } from './EditPipelineForm';

export default async function PipelineEditPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const pipeline = await getPipeline(id);

  return <EditPipelineForm pipeline={pipeline} />;
}
