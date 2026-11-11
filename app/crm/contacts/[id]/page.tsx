/**
 * AgencyOS CRM Contact Detail page.
 * Client component that shows contact details with Edit and Delete actions.
 *
 * Next.js 16: `params` is a Promise for client pages too, so it must not be
 * read synchronously (`params.id`) — doing so throws
 * "A param property was accessed directly with params.id" in development and
 * leaves the id undefined at runtime. Route params are read with useParams(),
 * which returns the resolved values.
 */

'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
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

interface ContactAuditUser {
  id: string;
  name: string;
}

interface ContactRecord {
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
  createdByUser: ContactAuditUser | null;
  updatedByUser: ContactAuditUser | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Render an audit identity (Created By / Updated By).
 *
 * The API resolves the referenced user to a display name when the user belongs
 * to the same organization. When it cannot (user removed, or identity withheld
 * by organization isolation) we say so instead of printing a raw database id.
 */
function AuditUserLabel({
  user,
  fallbackId,
}: {
  user: ContactAuditUser | null;
  fallbackId: string | null;
}) {
  if (user?.name) {
    return <span title={fallbackId ?? undefined}>{user.name}</span>;
  }
  if (!fallbackId) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="text-muted-foreground" title={fallbackId}>
      User unavailable
    </span>
  );
}

type ContactLoadState =
  | { status: 'loading' }
  | { status: 'ready'; contact: ContactRecord }
  | { status: 'not-found' }
  | { status: 'error' };

export default function ContactDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  // Defensive: a dynamic segment is normally a string, but never interpolate a
  // non-string (or an unresolved value) into the API URL.
  const rawId: unknown = params?.id;
  const id = typeof rawId === 'string' ? rawId : '';

  const { toast } = useToast();
  const toastRef = React.useRef(toast);
  // Keep the ref in sync with the latest toast function so the data-fetching
  // effect can call it without depending on `toast` directly (which would
  // cause an infinite re-fetch loop).
  React.useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [state, setState] = React.useState<ContactLoadState>({ status: 'loading' });
  const [deleting, setDeleting] = React.useState(false);
  // Accessible confirmation dialog state (replaces window.confirm()).
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;

    // No route param yet (or an unusable one): do not fetch `/contacts/undefined`.
    // The not-found view is derived during render, so no state is set here.
    if (!id) {
      return () => {
        mounted = false;
      };
    }

    (async () => {
      try {
        const res = await fetch(`/api/v1/crm/contacts/${encodeURIComponent(id)}`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!mounted) return;

        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (res.status === 404) {
          // Genuinely missing, soft-deleted, or belongs to another organization
          // (the API is non-disclosing, so all three are 404 by design).
          setState({ status: 'not-found' });
          return;
        }
        if (!res.ok) {
          setState({ status: 'error' });
          toastRef.current({ title: 'Error', description: 'Failed to load contact' });
          return;
        }

        const data = (await res.json()) as ContactRecord;
        if (!mounted) return;
        setState({ status: 'ready', contact: data });
      } catch {
        if (!mounted) return;
        setState({ status: 'error' });
        toastRef.current({ title: 'Error', description: 'Failed to load contact' });
      }
    })();

    return () => {
      mounted = false;
    };
  }, [id, router, reloadToken]);

  /**
   * Soft-delete the contact. Called from the AlertDialog's confirm action; the
   * event is prevented so the dialog stays open (and shows a busy state) until
   * the request settles.
   */
  async function handleConfirmDelete(event?: React.MouseEvent) {
    event?.preventDefault();
    if (!id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/crm/contacts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: 'Delete failed',
          description: errData.error || 'Unable to delete contact',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Deleted', description: 'Contact has been deleted' });
      setConfirmDeleteOpen(false);
      router.push('/crm/contacts');
      router.refresh();
    } catch {
      toast({
        title: 'Delete failed',
        description: 'Unable to delete contact',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  }

  // An unusable route param can never resolve to a contact; derive that during
  // render rather than setting state inside the effect.
  const viewState: ContactLoadState = id ? state : { status: 'not-found' };

  if (viewState.status === 'loading') {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          Loading contact…
        </div>
      </div>
    );
  }

  if (viewState.status === 'error') {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <p className="text-muted-foreground">Unable to load contact.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setReloadToken((token) => token + 1)}>
              Try again
            </Button>
            <Link
              href="/crm/contacts"
              className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              Back to Contacts
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const contact = viewState.status === 'ready' ? viewState.contact : null;

  if (!contact) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <p className="text-muted-foreground">Contact not found.</p>
          <Link
            href="/crm/contacts"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Contacts
          </Link>
        </div>
      </div>
    );
  }

  const isDeleted = Boolean(contact.deletedAt);
  const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{displayName || 'Contact'}</h1>
          <p className="text-muted-foreground">
            {contact.email ?? 'No email'} &bull; {contact.phone ?? 'No phone'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isDeleted && (
            <Button asChild variant="outline">
              <Link href={`/crm/contacts/${contact.id}/edit`}>Edit</Link>
            </Button>
          )}
          {!isDeleted && (
            <Button
              variant="destructive"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/crm/contacts">Back to Contacts</Link>
          </Button>
        </div>
      </div>

      {isDeleted && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-destructive">This contact has been deleted</p>
            <p className="text-sm text-muted-foreground">
              It was deleted on{' '}
              {new Date(contact.deletedAt as Date).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              and no longer appears in the contacts list. The record is shown for reference only and
              cannot be edited or deleted again.
            </p>
          </div>
        </div>
      )}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {displayName || 'This contact'} will be marked as deleted and removed from the
              contacts list. The record and its audit history are retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete contact'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Contact Details</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">First Name</dt>
              <dd className="font-medium">{contact.firstName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last Name</dt>
              <dd className="font-medium">{contact.lastName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="font-medium">
                {contact.email ?? <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Phone</dt>
              <dd className="font-medium">
                {contact.phone ?? <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd
                className={`font-medium ${
                  contact.status === 'active'
                    ? 'text-green-800'
                    : contact.status === 'inactive'
                      ? 'text-red-800'
                      : 'text-muted-foreground'
                }`}
              >
                {contact.status}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Source</dt>
              <dd className="font-medium">{contact.source ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Account</dt>
              <dd className="font-medium">
                {contact.accountId ? (
                  <Link
                    href={`/crm/accounts/${contact.accountId}`}
                    className="text-accent hover:underline"
                  >
                    View Account
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No account linked</span>
                )}
              </dd>
            </div>
            {contact.deletedAt && (
              <div>
                <dt className="text-xs text-muted-foreground">Deleted At</dt>
                <dd className="font-medium text-destructive">
                  {new Date(contact.deletedAt).toLocaleDateString()}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="col-span-2 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Audit Information</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">Created By</dt>
              <dd className="font-medium">
                <AuditUserLabel user={contact.createdByUser} fallbackId={contact.createdBy} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Updated By</dt>
              <dd className="font-medium">
                <AuditUserLabel user={contact.updatedByUser} fallbackId={contact.updatedBy} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created At</dt>
              <dd className="font-medium">{new Date(contact.createdAt).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Updated At</dt>
              <dd className="font-medium">{new Date(contact.updatedAt).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">PII Masked</dt>
              <dd
                className={`font-medium ${
                  contact.isMasked ? 'text-amber-800' : 'text-muted-foreground'
                }`}
              >
                {contact.isMasked ? 'Yes' : 'No'}
              </dd>
            </div>
          </dl>

          {!isDeleted && (
            <div className="mt-6 pt-5 border-t border-border">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Sales &amp; Finance Documents
              </h3>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/sales/proposals/builder?contactId=${encodeURIComponent(contact.id)}`}
                  className="px-3 py-1.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-muted"
                >
                  + New Proposal
                </Link>
                <Link
                  href={`/sales/quotations/builder?contactId=${encodeURIComponent(contact.id)}`}
                  className="px-3 py-1.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-muted"
                >
                  + New Quotation
                </Link>
                <Link
                  href={`/finance/estimates/new?clientId=${encodeURIComponent(contact.id)}`}
                  className="px-3 py-1.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-muted"
                >
                  + New Estimate
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
