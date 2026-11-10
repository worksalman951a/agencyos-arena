/**
 * AgencyOS Project Template Detail page.
 */

import Link from 'next/link';
import { getProjectTemplate } from '@/lib/services/projects/project-template-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DeleteTemplateButton } from '../DeleteTemplateButton';

export default async function ProjectTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await loadPageData(() => getProjectTemplate(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref="/projects/templates"
        backLabel="Back to templates"
      />
    );
  }

  const template = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{template.name}</h1>
          <p className="text-sm text-muted-foreground">
            Used by {template.projectCount} project{template.projectCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/projects/templates"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Templates
          </Link>
          <Link
            href={`/projects/new?templateId=${template.id}`}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            Create Project from Template
          </Link>
          <Link
            href={`/projects/templates/${template.id}/edit`}
            className="px-4 py-2 bg-muted text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Edit
          </Link>
          <DeleteTemplateButton templateId={template.id} redirectAfter />
        </div>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-2xl space-y-3">
        <h2 className="text-lg font-semibold">Description</h2>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {template.description || 'No description provided.'}
        </p>
        <div className="pt-3 border-t border-border text-xs text-muted-foreground flex justify-between">
          <span>Created {new Date(template.createdAt).toLocaleString()}</span>
          <span>Updated {new Date(template.updatedAt).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
