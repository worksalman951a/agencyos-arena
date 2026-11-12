'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BentoPipelinesView, type PipelineItem } from '@/components/crm/bento-pipelines-view';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface PipelinesClientProps {
  pipelines: PipelineItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
}

export function PipelinesClient({
  pipelines,
  total,
  totalPages,
  page,
  searchVal,
}: PipelinesClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [searchInput, setSearchInput] = React.useState(searchVal);

  const handleSearch = (newSearch: string) => {
    const query = new URLSearchParams();
    if (newSearch) query.set('search', newSearch);
    query.set('page', '1');
    router.push(`/crm/pipelines?${query.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(searchInput);
  };

  if (isBento) {
    return (
      <BentoPipelinesView
        pipelines={pipelines}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={searchVal}
        onSearchChange={handleSearch}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Pipelines</h1>
        <Button asChild>
          <Link href="/crm/pipelines/new">New Pipeline</Link>
        </Button>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex gap-2 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search pipelines..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search pipelines"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      <div className="overflow-x-auto border rounded-lg bg-card">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Description</th>
              <th className="p-3 font-medium">Default</th>
              <th className="p-3 font-medium w-24">Created</th>
              <th className="p-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pipelines.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No pipelines found.
                </td>
              </tr>
            ) : (
              pipelines.map((pipeline) => (
                <tr key={pipeline.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium">{pipeline.name}</td>
                  <td className="p-3 text-muted-foreground">{pipeline.description ?? '—'}</td>
                  <td className="p-3">
                    {pipeline.isDefault ? (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                        Default
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3 text-sm text-muted-foreground">
                    {new Date(pipeline.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-3">
                    <Link
                      href={`/crm/pipelines/${pipeline.id}`}
                      className="text-accent hover:underline text-sm font-medium"
                    >
                      View Stages
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Page {page} of {totalPages} ({total} total)
        </div>
      )}
    </div>
  );
}
