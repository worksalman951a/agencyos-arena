/**
 * AgencyOS Project Templates page.
 * Lists project templates for the current organization via the guarded service layer.
 */

import Link from 'next/link';
import { listProjectTemplates } from '@/lib/services/projects/project-template-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { DeleteTemplateButton } from './DeleteTemplateButton';

export default async function ProjectTemplatesPage() {
  const result = await loadPageData(() => listProjectTemplates());

  if (!result.ok) {
    return (
      <PageStateNotice reason={result.reason} backHref="/projects" backLabel="Back to projects" />
    );
  }

  const templates = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Project Templates</h1>
        <Link
          href="/projects/templates/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Template
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Description</th>
              <th className="pb-3 font-medium text-right">Projects</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-48 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No templates found. Create a template to get started.
                </td>
              </tr>
            ) : (
              templates.map((template) => (
                <tr key={template.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    <Link
                      href={`/projects/templates/${template.id}`}
                      className="text-accent hover:underline"
                    >
                      {template.name}
                    </Link>
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {template.description ?? '—'}
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {template.projectCount}
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(template.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right whitespace-nowrap space-x-3">
                    <Link
                      href={`/projects/new?templateId=${template.id}`}
                      className="text-sm text-accent hover:underline"
                    >
                      Use
                    </Link>
                    <Link
                      href={`/projects/templates/${template.id}/edit`}
                      className="text-sm text-muted-foreground hover:underline"
                    >
                      Edit
                    </Link>
                    <DeleteTemplateButton templateId={template.id} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
