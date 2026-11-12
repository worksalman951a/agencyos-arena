'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, Star, ExternalLink } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { TemplateResponse } from '@/lib/services/documents/template-service';
import '@/components/crm/bento-contacts.css';

interface BentoTemplatesViewProps {
  templates: TemplateResponse[];
}

export function BentoTemplatesView({ templates }: BentoTemplatesViewProps) {
  const [searchVal, setSearchVal] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('all');

  const types = React.useMemo(() => {
    return Array.from(new Set(templates.map((t) => t.type).filter(Boolean)));
  }, [templates]);

  const filteredTemplates = React.useMemo(() => {
    return templates.filter((t) => {
      if (typeFilter !== 'all' && t.type.toLowerCase() !== typeFilter.toLowerCase()) {
        return false;
      }
      if (!searchVal.trim()) return true;
      const q = searchVal.trim().toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q) ||
        (t.content && t.content.toLowerCase().includes(q))
      );
    });
  }, [templates, searchVal, typeFilter]);

  const defaultCount = templates.filter((t) => t.isDefault).length;

  return (
    <div className="bento-crm">
      {/* ── Page Header Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Documents</span>
            <span>/</span>
            <span>Standard Templates</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Document Templates
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {templates.length} {templates.length === 1 ? 'template' : 'templates'} configured for
            sales, legal, and operational documents
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/documents/contracts">Contracts</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/documents/links">Shareable Links</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/documents/templates/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Template
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Templates',
            value: String(templates.length),
            note: 'reusable document types',
          },
          {
            label: 'Distinct Types',
            value: String(types.length),
            note: 'proposals, contracts, quotes',
          },
          {
            label: 'Default Standards',
            value: String(defaultCount),
            note: 'applied on creation',
            tone: defaultCount > 0 ? 'ok' : undefined,
          },
          {
            label: 'Active Variables',
            value: String(
              templates.reduce(
                (acc, t) => acc + (t.variables ? Object.keys(t.variables).length : 0),
                0
              )
            ),
            note: 'dynamic merge fields',
          },
        ]}
      />

      {/* ── Filter Toolbar ────────────────────────────────────────────── */}
      <div className="bento-toolbar">
        <div className="bento-search">
          <Search size={14} strokeWidth={2} />
          <input
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            placeholder="Search templates by name, type, or content..."
            aria-label="Search templates"
          />
          {searchVal && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSearchVal('')}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>

        <div className="bento-status-pills" role="tablist" aria-label="Filter templates by type">
          <button
            type="button"
            role="tab"
            aria-selected={typeFilter === 'all'}
            onClick={() => setTypeFilter('all')}
            className={`bento-filter-pill ${typeFilter === 'all' ? 'bento-filter-pill--active' : ''}`}
          >
            All Types
          </button>
          {types.map((tp) => {
            const isActive = typeFilter.toLowerCase() === tp.toLowerCase();
            return (
              <button
                key={tp}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTypeFilter(tp)}
                className={`bento-filter-pill ${isActive ? 'bento-filter-pill--active' : ''}`}
              >
                {tp.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Bento Grid of Templates ────────────────────────────────────── */}
      {filteredTemplates.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              searchVal || typeFilter !== 'all'
                ? 'No templates match those filters'
                : 'No templates found'
            }
            sub="Create reusable templates to streamline contract and proposal generation."
            action={{
              label: 'Create Template',
              onClick: () => {
                const link = document.createElement('a');
                link.href = '/documents/templates/new';
                link.click();
              },
            }}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((tpl) => {
            const variableKeys = tpl.variables ? Object.keys(tpl.variables) : [];
            return (
              <Panel
                key={tpl.id}
                title={tpl.name}
                action={
                  tpl.isDefault ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      <Star size={11} className="fill-emerald-600 text-emerald-600" /> Default
                    </span>
                  ) : null
                }
              >
                <div className="space-y-3 text-xs flex flex-col justify-between h-full">
                  <div className="space-y-2">
                    <KeyValueRow
                      label="Document Type"
                      value={<StatusPill tone="neutral">{tpl.type.toUpperCase()}</StatusPill>}
                    />
                    <KeyValueRow
                      label="Merge Variables"
                      value={
                        variableKeys.length > 0 ? (
                          <span className="font-mono text-[11px] text-accent">
                            {variableKeys.length} {variableKeys.length === 1 ? 'var' : 'vars'} (
                            {variableKeys.slice(0, 2).join(', ')}
                            {variableKeys.length > 2 ? '…' : ''})
                          </span>
                        ) : (
                          'None'
                        )
                      }
                    />
                    <KeyValueRow
                      label="Updated"
                      value={new Date(tpl.updatedAt).toLocaleDateString()}
                    />
                    {tpl.content && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-2 pt-2 border-t border-border">
                        {tpl.content}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
                    <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                      <Link href={`/documents/templates/${tpl.id}`}>
                        Configure <ExternalLink size={11} className="ml-1" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
