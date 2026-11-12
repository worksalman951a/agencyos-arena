import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listPipelines } from '@/lib/services/crm/pipeline-service';
import { PipelinesClient } from './pipelines-client';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function PipelinesPage({ searchParams }: PageProps) {
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

  const { pipelines, total, totalPages } = await listPipelines({
    page,
    pageSize,
    search: search || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    includeDeleted: false,
  });

  const formattedPipelines = pipelines.map(
    (pipeline: {
      id: string;
      organizationId: string;
      name: string;
      description: string | null;
      isDefault: boolean;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }) => ({
      id: pipeline.id,
      organizationId: pipeline.organizationId,
      name: pipeline.name,
      description: pipeline.description,
      isDefault: pipeline.isDefault,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
      deletedAt: pipeline.deletedAt,
    })
  );

  return (
    <div className="space-y-6 p-6">
      <PipelinesClient
        pipelines={formattedPipelines}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={search}
      />
    </div>
  );
}
