/**
 * AgencyOS Edit Project page.
 */

import { getProject } from '@/lib/services/crm/project-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { EditProjectForm } from './EditProjectForm';

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => getProject(id));

  if (!result.ok) {
    return (
      <PageStateNotice reason={result.reason} backHref="/projects" backLabel="Back to projects" />
    );
  }

  return (
    <div className="p-6">
      <EditProjectForm project={result.data} />
    </div>
  );
}
