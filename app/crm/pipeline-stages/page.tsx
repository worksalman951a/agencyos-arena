import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listPipelineStages } from '@/lib/services/crm/pipeline-stage-service';
import { PipelineStagesClient } from './pipeline-stages-client';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function PipelineStagesPage({ searchParams }: PageProps) {
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
  const pipelineId = String(resolvedParams.pipelineId ?? '');

  const { stages, total, totalPages } = await listPipelineStages(pipelineId || undefined, {
    page,
    pageSize,
    search: search || undefined,
    sortBy: 'order',
    sortOrder: 'asc',
    includeDeleted: false,
  });

  const formattedStages = stages.map(
    (stage: {
      id: string;
      pipelineId: string;
      name: string;
      order: number;
      color: string | null;
      probability: number | null;
      isWon: boolean;
      isLost: boolean;
      pipeline: { id: string; name: string } | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }) => ({
      id: stage.id,
      pipelineId: stage.pipelineId,
      name: stage.name,
      order: stage.order,
      color: stage.color,
      probability: stage.probability,
      isWon: stage.isWon,
      isLost: stage.isLost,
      pipeline: stage.pipeline,
      createdAt: stage.createdAt,
      updatedAt: stage.updatedAt,
      deletedAt: stage.deletedAt,
    })
  );

  return (
    <div className="space-y-6 p-6">
      <PipelineStagesClient
        stages={formattedStages}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={search}
        pipelineIdVal={pipelineId}
      />
    </div>
  );
}
