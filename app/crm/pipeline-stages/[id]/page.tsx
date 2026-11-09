/**
 * AgencyOS CRM Pipeline Stage Detail page.
 * Server component that shows stage details with related pipeline info.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getPipelineStage } from '@/lib/services/crm/pipeline-stage-service';

export default async function PipelineStageDetailPage({
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

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{stage.name}</h1>
          <p className="text-muted-foreground">
            Order: {stage.order} &bull; Pipeline: {stage.pipelineId}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/crm/pipelines/${stage.pipelineId}`}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            View Pipeline
          </Link>
          <Link
            href={`/crm/pipeline-stages/${stage.id}/edit?pipelineId=${stage.pipelineId}`}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Edit
          </Link>
          <Link
            href="/crm/pipeline-stages"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Stages
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Stage Details</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="font-medium">{stage.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order</dt>
              <dd className="font-medium">{stage.order}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Color</dt>
              <dd className="font-medium">
                {stage.color ? (
                  <span
                    className="inline-block w-4 h-4 rounded-full border border-border"
                    style={{ backgroundColor: stage.color }}
                  ></span>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Probability</dt>
              <dd className="font-medium">{stage.probability ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Pipeline</dt>
              <dd className="font-medium">{stage.pipelineId}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Type</dt>
              <dd className="font-medium">
                {stage.isWon ? (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Won</span>
                ) : stage.isLost ? (
                  <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Lost</span>
                ) : (
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Open</span>
                )}
              </dd>
            </div>
            {stage.deletedAt && (
              <div>
                <dt className="text-xs text-muted-foreground">Deleted At</dt>
                <dd className="font-medium text-destructive">
                  {new Date(stage.deletedAt).toLocaleDateString()}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
