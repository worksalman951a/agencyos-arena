/**
 * AgencyOS CRM Contacts page.
 * Client component that lists contacts with View/Edit/Delete actions
 * and toast notifications for delete operations.
 */

'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Contact {
  id: string;
  organizationId: string;
  accountId: string | null;
  firstName: string | null;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  isMasked: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export default function ContactsPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const toastRef = React.useRef(toast);
  // Keep the ref in sync with the latest toast function so the data-fetching
  // effect can call it without depending on `toast` directly (which would
  // cause an infinite re-fetch loop).
  React.useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [isLoading, setIsLoading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  // Contact awaiting delete confirmation (accessible dialog, no window.confirm).
  const [pendingDelete, setPendingDelete] = React.useState<Contact | null>(null);

  const pageNum = Math.max(1, parseInt(String(searchParams.get('page') ?? '1'), 10));
  const pageSizeNum = Math.min(
    100,
    Math.max(1, parseInt(String(searchParams.get('pageSize') ?? '20'), 10))
  );
  const searchVal = String(searchParams.get('search') ?? '');
  // Explicit opt-in to soft-deleted records. Defaults to false so ordinary
  // lists never show deleted contacts.
  const includeDeleted = searchParams.get('includeDeleted') === 'true';

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/v1/crm/contacts?page=${pageNum}&pageSize=${pageSizeNum}&search=${encodeURIComponent(searchVal)}&sortBy=createdAt&sortOrder=desc&includeDeleted=${includeDeleted}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' },
          }
        );
        if (!mounted) return;
        if (!res.ok) {
          toastRef.current({ title: 'Error', description: 'Failed to load contacts' });
          return;
        }
        const data = await res.json();
        if (!mounted) return;
        setContacts(data.contacts ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 0);
        setPage(data.page ?? pageNum);
      } catch {
        if (!mounted) return;
        toastRef.current({ title: 'Error', description: 'Failed to load contacts' });
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [pageNum, pageSizeNum, searchVal, includeDeleted]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/crm/contacts/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast({
          title: 'Delete failed',
          description: errData.error || 'Unable to delete contact',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Deleted', description: 'Contact has been deleted' });
      setContacts((prev) => prev.filter((c) => c.id !== id));
      setTotal((prev) => prev - 1);
      setPendingDelete(null);
    } catch {
      toast({
        title: 'Delete failed',
        description: 'Unable to delete contact',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Contacts</h1>
        <Link
          href="/crm/contacts/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Contact
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form className="flex gap-2 max-w-sm">
          <input
            type="text"
            name="search"
            defaultValue={searchVal}
            placeholder="Search contacts..."
            className="flex-1 border border-input rounded-md px-3 py-2 text-sm"
          />
          {includeDeleted && <input type="hidden" name="includeDeleted" value="true" />}
          <button
            type="submit"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Search
          </button>
        </form>
        <Button asChild variant={includeDeleted ? 'secondary' : 'outline'} size="sm">
          <Link
            href={includeDeleted ? '/crm/contacts' : '/crm/contacts?includeDeleted=true'}
            aria-pressed={includeDeleted}
          >
            {includeDeleted ? 'Hide deleted' : 'Show deleted'}
          </Link>
        </Button>
      </div>

      {includeDeleted && (
        <p className="text-sm text-muted-foreground">
          Deleted contacts are included. They are kept for reference and are not restored from here.
        </p>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          Loading contacts…
        </div>
      )}

      {!isLoading && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-sm text-muted-foreground">
                <th className="pb-3 font-medium">Name</th>
                <th className="pb-3 font-medium">Email</th>
                <th className="pb-3 font-medium">Phone</th>
                <th className="pb-3 font-medium">Account</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium w-24">Created</th>
                <th className="pb-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    No contacts found.
                  </td>
                </tr>
              ) : (
                contacts.map((contact) => (
                  <tr key={contact.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">
                      <Link
                        href={`/crm/contacts/${contact.id}`}
                        className="text-accent hover:underline"
                      >
                        {contact.firstName} {contact.lastName}
                      </Link>
                    </td>
                    <td className="py-4">{contact.email ?? '—'}</td>
                    <td className="py-4">{contact.phone ?? '—'}</td>
                    <td className="py-4">
                      {contact.accountId ? (
                        <Link
                          href={`/crm/accounts/${contact.accountId}`}
                          className="text-accent hover:underline text-sm"
                        >
                          View Account
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="py-4">
                      <span>{contact.status}</span>
                      {contact.deletedAt && (
                        <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                          Deleted
                        </span>
                      )}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(contact.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/crm/contacts/${contact.id}`}
                          className="text-xs text-muted-foreground hover:text-accent"
                          title="View"
                        >
                          View
                        </Link>
                        <Link
                          href={`/crm/contacts/${contact.id}/edit`}
                          className="text-xs text-muted-foreground hover:text-accent"
                          title="Edit"
                        >
                          Edit
                        </Link>
                        {contact.deletedAt ? (
                          <span className="text-xs text-muted-foreground">Deleted</span>
                        ) : (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setPendingDelete(contact)}
                            disabled={deletingId === contact.id}
                            title="Delete"
                          >
                            {deletingId === contact.id ? 'Deleting…' : 'Delete'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Page {page} of {totalPages} ({total} total)
        </div>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingId) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {[pendingDelete?.firstName, pendingDelete?.lastName].filter(Boolean).join(' ') ||
                'This contact'}{' '}
              will be marked as deleted and removed from the contacts list. The record and its audit
              history are retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(deletingId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (pendingDelete) void handleDelete(pendingDelete.id);
              }}
            >
              {deletingId ? 'Deleting…' : 'Delete contact'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
