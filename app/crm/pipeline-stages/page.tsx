/**
 * AgencyOS CRM Pipeline Stages page.
 * Server component that lists pipeline stages for the current organization.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listPipelineStages } from '@/lib/services/crm/pipeline-stage-service';

export default async function PipelineStagesPage({
  searchParams: searchParamsPromise,
}: {
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

  const page = Math.max(1, parseInt(String(searchParams.page ?? '1'), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(searchParams.pageSize ?? '20'), 10)));
  const search = String(searchParams.search ?? '');
  const pipelineId = String(searchParams.pipelineId ?? '');

  const { stages, total, totalPages } = await listPipelineStages(pipelineId || undefined, {
    page,
    pageSize,
    search: search || undefined,
    sortBy: 'order',
    sortOrder: 'asc',
    includeDeleted: false,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Pipeline Stages</h1>
        <div className="flex gap-2">
          <Link
            href="/crm/pipeline-stages/new"
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

      <form className="flex flex-col sm:flex-row gap-2 max-w-2xl" action="">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search stages by name..."
          className="flex-1 border border-input rounded-md px-3 py-2 text-sm"
        />
        <input
          type="text"
          name="pipelineId"
          defaultValue={pipelineId}
          placeholder="Filter by Pipeline ID..."
          className="border border-input rounded-md px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Filter
        </button>
        {(search || pipelineId) && (
          <Link
            href="/crm/pipeline-stages"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80 ml-2"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Pipeline</th>
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
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No stages found. Create a stage to get started.
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
                  pipeline: { id: string; name: string } | null;
                }) => (
                  <tr key={stage.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">{stage.name}</td>
                    <td className="py-4">
                      {stage.pipeline ? (
                        <Link
                          href={`/crm/pipelines/${stage.pipeline.id}`}
                          className="text-accent hover:underline text-sm"
                        >
                          {stage.pipeline.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
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
                        href={`/crm/pipeline-stages/${stage.id}/edit`}
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
