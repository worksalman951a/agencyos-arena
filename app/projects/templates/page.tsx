/**
 * AgencyOS Project Templates page.
 * Lists project templates for the current organization via the guarded service layer.
 */

import { listProjectTemplates } from '@/lib/services/projects/project-template-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ProjectTemplatesClient } from './project-templates-client';

export default async function ProjectTemplatesPage() {
  const result = await loadPageData(() => listProjectTemplates());

  if (!result.ok) {
    return (
      <PageStateNotice reason={result.reason} backHref="/projects" backLabel="Back to projects" />
    );
  }

  const templates = result.data;

  return <ProjectTemplatesClient templates={templates} />;
}
