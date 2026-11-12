/**
 * AgencyOS CRM Pipeline Detail page.
 * Server component that shows pipeline details and its stages.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPipeline } from '@/lib/services/crm/pipeline-service';
import { listPipelineStages } from '@/lib/services/crm/pipeline-stage-service';
import { PipelineDetailClient } from './pipeline-detail-client';

export default async function PipelineDetailPage({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await searchParamsPromise;
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const pipeline = await getPipeline(id);

  const page = Math.max(1, parseInt(String(searchParams.page ?? '1'), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(searchParams.pageSize ?? '20'), 10)));

  const { stages, total, totalPages } = await listPipelineStages(pipeline.id, {
    page,
    pageSize,
    sortBy: 'order',
    sortOrder: 'asc',
    includeDeleted: false,
  });

  const formattedStages = stages.map(
    (s: {
      id: string;
      name: string;
      order: number;
      color: string | null;
      probability: number | null;
      isWon: boolean;
      isLost: boolean;
      createdAt: Date;
      updatedAt: Date;
    }) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      color: s.color,
      probability: s.probability,
      isWon: s.isWon,
      isLost: s.isLost,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })
  );

  return (
    <div className="space-y-6 p-6">
      <PipelineDetailClient
        pipeline={{
          id: pipeline.id,
          name: pipeline.name,
          description: pipeline.description,
          isDefault: pipeline.isDefault,
          createdAt: pipeline.createdAt,
          updatedAt: pipeline.updatedAt,
        }}
        stages={formattedStages}
        total={total}
        page={page}
        totalPages={totalPages}
      />
    </div>
  );
}
