'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Globe,
  MapPin,
  Calendar,
  Clock,
  ArrowLeft,
  Edit,
  Trash2,
  AlertTriangle,
  User,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  BentoAccountRecordView,
  type AccountDetailRecord,
} from '@/components/crm/bento-account-record-view';
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

interface AccountDetailClientProps {
  account: AccountDetailRecord;
}

export function AccountDetailClient({ account }: AccountDetailClientProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [deleting, setDeleting] = React.useState(false);

  const isDeleted = Boolean(account.deletedAt);
  const contacts = account.contacts ?? [];

  const handleDelete = async () => {
    if (
      !confirm(
        `Are you sure you want to delete ${account.name}? This will mark the account as deleted.`
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/crm/accounts/${account.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error?.message || 'Failed to delete account');
        return;
      }

      router.push('/crm/accounts');
      router.refresh();
    } catch {
      alert('An error occurred while deleting the account');
    } finally {
      setDeleting(false);
    }
  };

  if (isBento) {
    return (
      <BentoAccountRecordView
        account={account}
        onDeleteRequest={handleDelete}
        deleting={deleting}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/crm/accounts">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Accounts
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{account.name}</h1>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  isDeleted
                    ? 'bg-destructive/10 text-destructive'
                    : account.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {isDeleted ? 'Deleted' : account.status}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isDeleted && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/crm/accounts/${account.id}/edit`}>
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Link>
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                <Trash2 className="h-4 w-4 mr-1" />
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Deleted warning banner */}
      {isDeleted && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">This account has been deleted</p>
            <p className="text-xs text-destructive/80">
              Deleted on{' '}
              {new Date(account.deletedAt as Date).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              . This account is hidden from active lists and search results.
            </p>
          </div>
        </div>
      )}

      {/* Account Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-5 bg-card space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            Company Details
          </h2>

          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground block text-xs">Website</span>
              {(() => {
                const safeUrl = getSafeExternalUrl(account.website);
                return safeUrl ? (
                  <a
                    href={safeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline text-primary flex items-center gap-1 mt-0.5"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {account.website}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{account.website ?? 'Not provided'}</span>
                );
              })()}
            </div>

            <div>
              <span className="text-muted-foreground block text-xs">Address</span>
              {account.address ? (
                <span className="flex items-start gap-1 mt-0.5">
                  <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span>{account.address}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">Not provided</span>
              )}
            </div>

            <div>
              <span className="text-muted-foreground block text-xs">Status</span>
              <span className="capitalize mt-0.5 block">{account.status}</span>
            </div>
          </div>
        </div>

        <div className="border rounded-lg p-5 bg-card space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            Record Info
          </h2>

          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground block text-xs">Created</span>
              <span className="flex items-center gap-1 mt-0.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(account.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>

            <div>
              <span className="text-muted-foreground block text-xs">Last Updated</span>
              <span className="flex items-center gap-1 mt-0.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(account.updatedAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>

            <div>
              <span className="text-muted-foreground block text-xs">Total Contacts</span>
              <span className="mt-0.5 block font-medium">{account.contactCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Associated Contacts */}
      <div className="border rounded-lg p-5 bg-card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <User className="h-5 w-5 text-muted-foreground" />
            Contacts ({contacts.length})
          </h2>
          {!isDeleted && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/crm/contacts/new?accountId=${account.id}`}>
                <Plus className="h-4 w-4 mr-1" />
                Add Contact
              </Link>
            </Button>
          )}
        </div>

        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No contacts associated with this account.
          </p>
        ) : (
          <div className="divide-y">
            {contacts.map((contact) => (
              <div key={contact.id} className="py-3 flex items-center justify-between">
                <div>
                  <Link
                    href={`/crm/contacts/${contact.id}`}
                    className="font-medium hover:underline text-sm"
                  >
                    {[contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
                      'Unnamed Contact'}
                  </Link>
                  {contact.email && (
                    <span className="text-xs text-muted-foreground block">{contact.email}</span>
                  )}
                </div>
                {contact.phone && (
                  <span className="text-xs text-muted-foreground">{contact.phone}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
