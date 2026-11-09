/**
 * AgencyOS CRM Pipeline Stage Edit page.
 * Server component that fetches the stage and renders the edit form.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPipelineStage } from '@/lib/services/crm/pipeline-stage-service';
import { EditPipelineStageForm } from './EditPipelineStageForm';

export default async function PipelineStageEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const stage = await getPipelineStage(id);

  return <EditPipelineStageForm stage={stage} />;
}
