'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Eye, Edit2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BentoLeadsView, type LeadItem } from '@/components/crm/bento-leads-view';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface LeadsClientProps {
  leads: LeadItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
  statusFilter: string;
  priorityFilter: string;
}

export function LeadsClient({
  leads,
  total,
  totalPages,
  page,
  searchVal,
  statusFilter,
  priorityFilter,
}: LeadsClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const updateFilters = (newSearch: string, newStatus: string, newPriority: string) => {
    const query = new URLSearchParams();
    if (newSearch) query.set('search', newSearch);
    if (newStatus) query.set('status', newStatus);
    if (newPriority) query.set('priority', newPriority);
    query.set('page', '1');
    router.push(`/crm/leads?${query.toString()}`);
  };

  const handleSearch = (val: string) => updateFilters(val, statusFilter, priorityFilter);
  const handleStatus = (val: string) => updateFilters(searchVal, val, priorityFilter);
  const handlePriority = (val: string) => updateFilters(searchVal, statusFilter, val);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(searchInput);
  };

  const handleDelete = async (lead: LeadItem) => {
    if (
      !confirm(`Are you sure you want to delete this lead? This will mark the lead as deleted.`)
    ) {
      return;
    }

    setDeletingId(lead.id);
    try {
      const res = await fetch(`/api/v1/crm/leads/${lead.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error?.message || 'Failed to delete lead');
        return;
      }

      router.refresh();
    } catch {
      alert('An error occurred while deleting the lead');
    } finally {
      setDeletingId(null);
    }
  };

  if (isBento) {
    return (
      <BentoLeadsView
        leads={leads}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={searchVal}
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        onSearchChange={handleSearch}
        onStatusFilterChange={handleStatus}
        onPriorityFilterChange={handlePriority}
        onDeleteRequest={handleDelete}
        deletingId={deletingId}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Leads</h1>
        <Link
          href="/crm/leads/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Lead
        </Link>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search leads by source, status, priority, notes..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search leads"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => handleStatus(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="qualified">Qualified</option>
          <option value="proposal">Proposal Sent</option>
          <option value="negotiation">Negotiation</option>
          <option value="closed-won">Closed Won</option>
          <option value="closed-lost">Closed Lost</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => handlePriority(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
        {(searchVal || statusFilter || priorityFilter) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => updateFilters('', '', '')}>
            Clear
          </Button>
        )}
      </form>

      <div className="overflow-x-auto border rounded-lg bg-card">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="p-3 font-medium">Source</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Priority</th>
              <th className="p-3 font-medium">Contact</th>
              <th className="p-3 font-medium">Account</th>
              <th className="p-3 font-medium">Owner</th>
              <th className="p-3 font-medium text-right">Expected Value</th>
              <th className="p-3 font-medium">Converted</th>
              <th className="p-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-muted-foreground">
                  No leads found. Create a lead to get started.
                </td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr key={lead.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium">{lead.source}</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        lead.status === 'closed-won'
                          ? 'bg-green-100 text-green-800'
                          : lead.status === 'closed-lost'
                            ? 'bg-red-100 text-red-800'
                            : lead.status === 'qualified'
                              ? 'bg-blue-100 text-blue-800'
                              : lead.status === 'contacted'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {lead.status}
                    </span>
                  </td>
                  <td className="p-3">
                    {lead.priority ? (
                      <span className="capitalize">{lead.priority}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {lead.contact ? (
                      <Link
                        href={`/crm/contacts/${lead.contact.id}`}
                        className="text-accent hover:underline"
                      >
                        {`${lead.contact.firstName ?? ''} ${lead.contact.lastName}`.trim() ||
                          'Unnamed Contact'}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {lead.account ? (
                      <Link
                        href={`/crm/accounts/${lead.account.id}`}
                        className="text-accent hover:underline"
                      >
                        {lead.account.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {lead.ownerId ? (
                      <span>Assigned</span>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </td>
                  <td className="p-3 text-right font-medium">
                    {lead.expectedValue ? `$${Number(lead.expectedValue).toLocaleString()}` : '—'}
                  </td>
                  <td className="p-3">
                    {lead.convertedOpportunity ? (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                        Yes
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Link href={`/crm/leads/${lead.id}`} title="View">
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Link href={`/crm/leads/${lead.id}/edit`} title="Edit">
                          <Edit2 className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(lead)}
                        disabled={deletingId === lead.id}
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
