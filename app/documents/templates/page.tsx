/**
 * AgencyOS Documents - Templates List
 * Server component that lists document templates for the current organization.
 */

import { listTemplates, type TemplateResponse } from '@/lib/services/documents/template-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { TemplatesClient } from './templates-client';

export default async function TemplatesListPage() {
  const result = await loadPageData(() => listTemplates());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const templates: TemplateResponse[] = result.data;

  return (
    <div className="p-6">
      <TemplatesClient templates={templates} />
    </div>
  );
}
