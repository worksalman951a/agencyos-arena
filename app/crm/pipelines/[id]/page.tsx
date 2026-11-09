/**
 * AgencyOS CRM Pipeline Detail page.
 * Server component that shows pipeline details and its stages.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getPipeline } from '@/lib/services/crm/pipeline-service';
import { listPipelineStages } from '@/lib/services/crm/pipeline-stage-service';

export default async function PipelineDetailPage({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Next.js 16: searchParams is a Promise; filters/pagination must be read after awaiting it.
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

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{pipeline.name}</h1>
          {pipeline.description && <p className="text-muted-foreground">{pipeline.description}</p>}
        </div>
        <div className="flex gap-2">
          <Link
            href="/crm/pipelines/new"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Pipeline
          </Link>
          <Link
            href={`/crm/pipeline-stages/new?pipelineId=${pipeline.id}`}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Stage
          </Link>
          <Link
            href="/crm/pipelines"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Pipelines
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Pipeline Details</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="font-medium">{pipeline.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Description</dt>
              <dd className="font-medium">{pipeline.description ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Default Pipeline</dt>
              <dd
                className={`font-medium ${pipeline.isDefault ? 'text-green-800' : 'text-muted-foreground'}`}
              >
                {pipeline.isDefault ? 'Yes' : 'No'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total Stages</dt>
              <dd className="font-medium">{total}</dd>
            </div>
          </dl>
        </div>
      </div>

      <h2 className="text-xl font-bold">Stages</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Order</th>
              <th className="pb-3 font-medium">Color</th>
              <th className="pb-3 font-medium">Probability</th>
              <th className="pb-3 font-medium">Type</th>
              <th className="pb-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stages.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  No stages found. Add a stage to get started.
                </td>
              </tr>
            ) : (
              stages.map(
                (stage: {
                  id: string;
                  name: string;
                  order: number;
                  color: string | null;
                  probability: number | null;
                  isWon: boolean;
                  isLost: boolean;
                }) => (
                  <tr key={stage.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">{stage.name}</td>
                    <td className="py-4">{stage.order}</td>
                    <td className="py-4">
                      {stage.color ? (
                        <span
                          className="inline-block w-4 h-4 rounded-full border border-border"
                          style={{ backgroundColor: stage.color }}
                        ></span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="py-4">{stage.probability ?? '—'}</td>
                    <td className="py-4">
                      {stage.isWon ? (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                          Won
                        </span>
                      ) : stage.isLost ? (
                        <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">
                          Lost
                        </span>
                      ) : (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          Open
                        </span>
                      )}
                    </td>
                    <td className="py-4">
                      <Link
                        href={`/crm/pipeline-stages/${stage.id}/edit?pipelineId=${pipeline.id}`}
                        className="text-accent hover:underline text-sm"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Page {page} of {totalPages} ({total} total)
        </div>
      )}
    </div>
  );
}
