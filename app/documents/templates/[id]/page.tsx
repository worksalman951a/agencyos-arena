/**
 * AgencyOS Documents - Template Detail
 * Server component displaying a single reusable document template.
 */

import { getTemplate } from '@/lib/services/documents/template-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { TemplateDetailClient } from './TemplateDetailClient';

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPageData(() => getTemplate(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref="/documents/templates"
        backLabel="Back to templates"
      />
    );
  }

  return (
    <div className="p-6">
      <TemplateDetailClient template={result.data} />
    </div>
  );
}
