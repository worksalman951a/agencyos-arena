/**
 * AgencyOS Documents - Templates List
 * Server component that lists document templates for the current organization.
 */

import Link from 'next/link';
import { listTemplates, type TemplateResponse } from '@/lib/services/documents/template-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export default async function TemplatesListPage() {
  const result = await loadPageData(() => listTemplates());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const templates: TemplateResponse[] = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Document Templates</h1>
          <p className="text-muted-foreground">
            Reusable templates for proposals, quotations, contracts, and client documents.
          </p>
        </div>
        <Link
          href="/documents/templates/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Template
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-md border bg-background p-6 text-center space-y-3">
          <h2 className="text-lg font-semibold">No templates yet</h2>
          <p className="text-muted-foreground">Create your first reusable document template.</p>
          <div>
            <Link
              href="/documents/templates/new"
              className="inline-block mt-2 px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Create Template
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-md border bg-background p-6 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b text-sm">
                <th className="pb-3 font-medium text-muted-foreground">Name</th>
                <th className="pb-3 font-medium text-muted-foreground">Type</th>
                <th className="pb-3 font-medium text-muted-foreground">Variables</th>
                <th className="pb-3 font-medium text-muted-foreground">Default</th>
                <th className="pb-3 font-medium text-muted-foreground">Updated</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const varKeys = t.variables ? Object.keys(t.variables) : [];
                return (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-4">
                      <Link
                        href={`/documents/templates/${t.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="py-4">
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize">
                        {t.type}
                      </span>
                    </td>
                    <td className="py-4 text-xs text-muted-foreground">
                      {varKeys.length > 0 ? varKeys.join(', ') : '—'}
                    </td>
                    <td className="py-4">
                      {t.isDefault ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-2.5 py-0.5 text-xs font-medium">
                          Default
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
