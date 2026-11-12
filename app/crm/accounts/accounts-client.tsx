'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Building2, Globe, MapPin, Trash2, Edit2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BentoAccountsView, type AccountItem } from '@/components/crm/bento-accounts-view';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

function getSafeExternalUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`
    );
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

interface AccountsClientProps {
  accounts: AccountItem[];
  total: number;
  totalPages: number;
  page: number;
  searchVal: string;
}

export function AccountsClient({
  accounts,
  total,
  totalPages,
  page,
  searchVal,
}: AccountsClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [searchInput, setSearchInput] = React.useState(searchVal);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const handleSearch = (newSearch: string) => {
    const query = new URLSearchParams();
    if (newSearch) query.set('search', newSearch);
    query.set('page', '1');
    router.push(`/crm/accounts?${query.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(searchInput);
  };

  const handleDelete = async (account: AccountItem) => {
    if (
      !confirm(
        `Are you sure you want to delete ${account.name}? This will mark the account as deleted.`
      )
    ) {
      return;
    }

    setDeletingId(account.id);
    try {
      const res = await fetch(`/api/v1/crm/accounts/${account.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error?.message || 'Failed to delete account');
        return;
      }

      router.refresh();
    } catch {
      alert('An error occurred while deleting the account');
    } finally {
      setDeletingId(null);
    }
  };

  if (isBento) {
    return (
      <BentoAccountsView
        accounts={accounts}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={searchVal}
        onSearchChange={handleSearch}
        onDeleteRequest={handleDelete}
        deletingId={deletingId}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your client organizations and companies ({total} total)
          </p>
        </div>
        <Button asChild>
          <Link href="/crm/accounts/new">
            <Plus className="h-4 w-4 mr-2" />
            New Account
          </Link>
        </Button>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search accounts..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search accounts"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      {/* Accounts Table */}
      {accounts.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-card">
          <Building2 className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">No accounts found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {searchVal
              ? 'Try adjusting your search terms'
              : 'Get started by creating your first client account'}
          </p>
          {!searchVal && (
            <Button asChild className="mt-4" size="sm">
              <Link href="/crm/accounts/new">
                <Plus className="h-4 w-4 mr-2" />
                Create Account
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th className="p-3 font-medium">Name</th>
                  <th className="p-3 font-medium">Website</th>
                  <th className="p-3 font-medium">Address</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium text-center">Contacts</th>
                  <th className="p-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {accounts.map((account) => (
                  <tr key={account.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <Link
                        href={`/crm/accounts/${account.id}`}
                        className="font-medium hover:underline text-foreground"
                      >
                        {account.name}
                      </Link>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {(() => {
                        const safeUrl = getSafeExternalUrl(account.website);
                        return safeUrl ? (
                          <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline flex items-center gap-1"
                          >
                            <Globe className="h-3 w-3" />
                            {account.website ? account.website.replace(/^https?:\/\//, '') : ''}
                          </a>
                        ) : (
                          (account.website ?? '—')
                        );
                      })()}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {account.address ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[200px]">{account.address}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          account.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {account.status}
                      </span>
                    </td>
                    <td className="p-3 text-center text-muted-foreground">
                      {account.contactCount}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Link href={`/crm/accounts/${account.id}`} title="View">
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Link href={`/crm/accounts/${account.id}/edit`} title="Edit">
                            <Edit2 className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(account)}
                          disabled={deletingId === account.id}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t text-sm text-muted-foreground">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/crm/accounts?page=${page - 1}&search=${encodeURIComponent(searchVal)}`}
                    >
                      Previous
                    </Link>
                  </Button>
                )}
                {page < totalPages && (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/crm/accounts?page=${page + 1}&search=${encodeURIComponent(searchVal)}`}
                    >
                      Next
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
