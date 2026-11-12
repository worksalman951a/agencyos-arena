/**
 * AgencyOS Project Files page.
 * Lists files for a project and provides upload, download, and delete controls.
 */

import { listProjectFiles } from '@/lib/services/projects/project-file-service';
import { getProject } from '@/lib/services/crm/project-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ProjectFilesClient } from './project-files-client';

export default async function ProjectFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => listProjectFiles(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref={`/projects/${id}`}
        backLabel="Back to project"
      />
    );
  }

  const projectResult = await loadPageData(() => getProject(id));
  const tasks = projectResult.ok
    ? projectResult.data.tasks.map((t) => ({ id: t.id, title: t.title }))
    : [];
  const projectName = projectResult.ok ? projectResult.data.name : undefined;
  const files = result.data;

  return (
    <ProjectFilesClient projectId={id} projectName={projectName} files={files} tasks={tasks} />
  );
}
