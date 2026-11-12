'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Eye, Edit2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  BentoOpportunitiesView,
  type OpportunityItem,
} from '@/components/crm/bento-opportunities-view';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface OpportunitiesClientProps {
  opportunities: OpportunityItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
}

export function OpportunitiesClient({
  opportunities,
  total,
  totalPages,
  page,
  searchVal,
  statusFilter,
}: OpportunitiesClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const updateFilters = (newSearch: string, newStatus: string) => {
    const query = new URLSearchParams();
    if (newSearch) query.set('search', newSearch);
    if (newStatus) query.set('status', newStatus);
    query.set('page', '1');
    router.push(`/crm/opportunities?${query.toString()}`);
  };

  const handleSearch = (val: string) => updateFilters(val, statusFilter);
  const handleStatus = (val: string) => updateFilters(searchVal, val);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(searchInput);
  };

  const handleDelete = async (opp: OpportunityItem) => {
    if (
      !confirm(
        `Are you sure you want to delete ${opp.title}? This will mark the opportunity as deleted.`
      )
    ) {
      return;
    }

    setDeletingId(opp.id);
    try {
      const res = await fetch(`/api/v1/crm/opportunities/${opp.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error?.message || 'Failed to delete opportunity');
        return;
      }

      router.refresh();
    } catch {
      alert('An error occurred while deleting the opportunity');
    } finally {
      setDeletingId(null);
    }
  };

  if (isBento) {
    return (
      <BentoOpportunitiesView
        opportunities={opportunities}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={searchVal}
        statusFilter={statusFilter}
        onSearchChange={handleSearch}
        onStatusFilterChange={handleStatus}
        onDeleteRequest={handleDelete}
        deletingId={deletingId}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Opportunities</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/crm/pipelines">Pipelines</Link>
          </Button>
          <Button asChild>
            <Link href="/crm/opportunities/new">
              <Plus className="h-4 w-4 mr-2" />
              New Opportunity
            </Link>
          </Button>
        </div>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search opportunities..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search opportunities"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => handleStatus(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
        {(searchVal || statusFilter) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => updateFilters('', '')}>
            Clear
          </Button>
        )}
      </form>

      <div className="overflow-x-auto border rounded-lg bg-card">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="p-3 font-medium">Title</th>
              <th className="p-3 font-medium">Account</th>
              <th className="p-3 font-medium">Contact</th>
              <th className="p-3 font-medium">Stage</th>
              <th className="p-3 font-medium text-right">Value</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No opportunities found.
                </td>
              </tr>
            ) : (
              opportunities.map((opp) => (
                <tr key={opp.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="p-3">
                    <Link
                      href={`/crm/opportunities/${opp.id}`}
                      className="font-medium hover:underline text-foreground"
                    >
                      {opp.title}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {opp.account ? (
                      <Link
                        href={`/crm/accounts/${opp.account.id}`}
                        className="text-accent hover:underline"
                      >
                        {opp.account.name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {opp.contact ? (
                      <Link
                        href={`/crm/contacts/${opp.contact.id}`}
                        className="text-accent hover:underline"
                      >
                        {[opp.contact.firstName, opp.contact.lastName].filter(Boolean).join(' ')}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3">
                    {opp.stage ? (
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-muted">
                        {opp.stage.name}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3 text-right font-medium">
                    {opp.value ? `${opp.currency} ${Number(opp.value).toLocaleString()}` : '—'}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        opp.status === 'won'
                          ? 'bg-green-100 text-green-800'
                          : opp.status === 'lost'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {opp.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Link href={`/crm/opportunities/${opp.id}`} title="View">
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Link href={`/crm/opportunities/${opp.id}/edit`} title="Edit">
                          <Edit2 className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(opp)}
                        disabled={deletingId === opp.id}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
