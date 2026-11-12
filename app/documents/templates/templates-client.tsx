'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoTemplatesView } from '@/components/documents/bento-templates-view';
import type { TemplateResponse } from '@/lib/services/documents/template-service';

interface TemplatesClientProps {
  templates: TemplateResponse[];
}

export function TemplatesClient({ templates }: TemplatesClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoTemplatesView templates={templates} />;
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
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
            <tbody className="divide-y text-sm">
              {templates.map((tpl) => (
                <tr key={tpl.id} className="hover:bg-muted/50">
                  <td className="py-3 font-medium">
                    <Link
                      href={`/documents/templates/${tpl.id}`}
                      className="text-accent hover:underline"
                    >
                      {tpl.name}
                    </Link>
                  </td>
                  <td className="py-3 uppercase text-xs font-mono">{tpl.type}</td>
                  <td className="py-3 text-xs text-muted-foreground">
                    {tpl.variables ? Object.keys(tpl.variables).join(', ') : '—'}
                  </td>
                  <td className="py-3">
                    {tpl.isDefault ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                        Default
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3 text-muted-foreground text-xs">
                    {new Date(tpl.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
