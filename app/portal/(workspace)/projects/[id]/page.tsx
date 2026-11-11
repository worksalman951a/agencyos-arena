/**
 * Portal project detail.
 *
 * Shows milestones and the deliverables that were shared individually. Task
 * titles, assignees, hours and budgets are never selected by the service, so they
 * cannot leak through this page.
 */

import Link from 'next/link';

import { getPortalProject } from '@/lib/services/portal/portal-workspace-service';
import { loadPortalPageData } from '@/lib/portal/page-data';

export const dynamic = 'force-dynamic';

export default async function PortalProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPortalPageData(() => getPortalProject(id));

  if (!result.ok) {
    return (
      <div role="alert" className="rounded-md border p-4 text-sm">
        {result.reason === 'not-found'
          ? 'This project is not available to you.'
          : 'This project could not be loaded right now.'}
        <div className="mt-2">
          <Link href="/portal/projects" className="text-accent hover:underline">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const project = result.data;
  const progress =
    project.milestoneCount === 0
      ? 0
      : Math.round((project.completedMilestones / project.milestoneCount) * 100);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal/projects" className="text-sm text-accent hover:underline">
          ← Projects
        </Link>
        <h2 className="mt-2 text-2xl font-bold">{project.name}</h2>
        <p className="text-sm text-muted-foreground">{project.description ?? 'No description'}</p>
      </div>

      <section className="rounded-lg border bg-background p-4">
        <h3 className="text-lg font-semibold">Progress</h3>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="project-progress">
          {project.completedMilestones}/{project.milestoneCount} milestones complete ({progress}%)
        </p>
        <div className="mt-2 h-2 w-full rounded-full bg-muted">
          <div className="h-2 rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h3 className="text-lg font-semibold">Milestones</h3>
        {project.milestones.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No milestones yet.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {project.milestones.map((milestone) => (
              <li key={milestone.id} className="flex items-center justify-between py-2 text-sm">
                <span>{milestone.name}</span>
                <span className="text-muted-foreground">
                  {milestone.status}
                  {milestone.dueDate ? ` · ${milestone.dueDate.toLocaleDateString()}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h3 className="text-lg font-semibold">Shared files</h3>
        {project.files.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No files have been shared for this project.
          </p>
        ) : (
          <ul className="mt-2 divide-y">
            {project.files.map((file) => (
              <li key={file.id} className="flex items-center justify-between py-2 text-sm">
                <span>{file.title}</span>
                <a
                  className="text-accent hover:underline"
                  href={`/api/v1/portal/download/file/${file.id}`}
                  data-testid={`download-file-${file.id}`}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {project.contracts.length > 0 ? (
        <section className="rounded-lg border bg-background p-4">
          <h3 className="text-lg font-semibold">Contracts</h3>
          <ul className="mt-2 divide-y">
            {project.contracts.map((contract) => (
              <li key={contract.id} className="flex items-center justify-between py-2 text-sm">
                <span>{contract.title}</span>
                <span className="text-muted-foreground">{contract.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
