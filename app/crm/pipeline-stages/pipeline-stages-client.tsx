'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  BentoPipelineStagesView,
  type PipelineStageItem,
} from '@/components/crm/bento-pipeline-stages-view';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface PipelineStagesClientProps {
  stages: PipelineStageItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  pipelineIdVal: string;
}

export function PipelineStagesClient({
  stages,
  total,
  totalPages,
  page,
  searchVal,
  pipelineIdVal,
}: PipelineStagesClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [pipelineInput, setPipelineInput] = React.useState(pipelineIdVal);

  const updateFilters = (newSearch: string, newPipelineId: string) => {
    const query = new URLSearchParams();
    if (newSearch) query.set('search', newSearch);
    if (newPipelineId) query.set('pipelineId', newPipelineId);
    query.set('page', '1');
    router.push(`/crm/pipeline-stages?${query.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters(searchInput, pipelineInput);
  };

  if (isBento) {
    return (
      <BentoPipelineStagesView
        stages={stages}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={searchVal}
        pipelineIdFilter={pipelineIdVal}
        onSearchChange={(val) => updateFilters(val, pipelineIdVal)}
        onPipelineFilterChange={(pId) => updateFilters(searchVal, pId)}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Pipeline Stages</h1>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/crm/pipeline-stages/new">New Stage</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/crm/pipelines">Back to Pipelines</Link>
          </Button>
        </div>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search stages by name..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search stages"
          />
        </div>
        <input
          type="text"
          value={pipelineInput}
          onChange={(e) => setPipelineInput(e.target.value)}
          placeholder="Filter by Pipeline ID..."
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        />
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
        {(searchVal || pipelineIdVal) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => updateFilters('', '')}>
            Clear
          </Button>
        )}
      </form>

      <div className="overflow-x-auto border rounded-lg bg-card">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Pipeline</th>
              <th className="p-3 font-medium">Order</th>
              <th className="p-3 font-medium">Probability</th>
              <th className="p-3 font-medium">Type</th>
              <th className="p-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stages.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  No stages found.
                </td>
              </tr>
            ) : (
              stages.map((stage) => (
                <tr key={stage.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium">{stage.name}</td>
                  <td className="p-3 text-muted-foreground">{stage.pipeline?.name ?? '—'}</td>
                  <td className="p-3">{stage.order}</td>
                  <td className="p-3">{stage.probability ? `${stage.probability}%` : '—'}</td>
                  <td className="p-3">
                    {stage.isWon ? (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                        Won
                      </span>
                    ) : stage.isLost ? (
                      <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                        Lost
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Standard</span>
                    )}
                  </td>
                  <td className="p-3">
                    <Link
                      href={`/crm/pipeline-stages/${stage.id}`}
                      className="text-accent hover:underline text-sm font-medium"
                    >
                      View
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
