/**
 * Portal projects list — only projects with a live grant are read.
 */

import Link from 'next/link';

import { listPortalProjects } from '@/lib/services/portal/portal-workspace-service';
import { loadPortalPageData } from '@/lib/portal/page-data';

export const dynamic = 'force-dynamic';

export default async function PortalProjectsPage() {
  const result = await loadPortalPageData(() => listPortalProjects());

  if (!result.ok) {
    return (
      <div
        role="alert"
        className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      >
        Projects are not available for this account right now.
      </div>
    );
  }

  const projects = result.data;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Projects</h2>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects have been shared with you yet.</p>
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => (
            <li key={project.id} className="rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/portal/projects/${project.id}`}
                  className="text-lg font-semibold hover:underline"
                >
                  {project.name}
                </Link>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs uppercase text-muted-foreground">
                  {project.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {project.milestoneCount} milestones · {project.completedMilestones} complete ·{' '}
                {project.completedTasks}/{project.taskCount} tasks done
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
