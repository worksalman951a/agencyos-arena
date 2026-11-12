'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, AlertTriangle, Building2 } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface BentoAccountFormViewProps {
  mode: 'new' | 'edit';
  accountId?: string;
  // Form fields
  name: string;
  setName: (val: string) => void;
  website: string;
  setWebsite: (val: string) => void;
  address: string;
  setAddress: (val: string) => void;
  status: string;
  setStatus: (val: string) => void;
  // Submission
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
}

export function BentoAccountFormView({
  mode,
  accountId,
  name,
  setName,
  website,
  setWebsite,
  address,
  setAddress,
  status,
  setStatus,
  onSubmit,
  isLoading,
  error,
}: BentoAccountFormViewProps) {
  const isEdit = mode === 'edit';

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link
              href={isEdit && accountId ? `/crm/accounts/${accountId}` : '/crm/accounts'}
              title="Cancel and return"
            >
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/accounts" className="hover:underline">
                CRM
              </Link>
              <span>/</span>
              <Link href="/crm/accounts" className="hover:underline">
                Accounts
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Account' : 'New Account'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit: ${name || 'Account'}` : 'Register New Account'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={isEdit && accountId ? `/crm/accounts/${accountId}` : '/crm/accounts'}>
              Cancel
            </Link>
          </Button>
          <Button onClick={onSubmit} size="sm" disabled={isLoading}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Account'}
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary ───────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Account Name',
            value: name || 'Unstated Business',
            note: isEdit ? 'Updating existing account' : 'New organization record',
          },
          {
            label: 'Web Domain',
            value: website ? website.replace(/^https?:\/\//, '') : 'None specified',
            note: 'Company online presence',
          },
          {
            label: 'Account Status',
            value: status.toUpperCase(),
            note: 'Relationship state',
            tone: status === 'active' ? 'ok' : undefined,
          },
          {
            label: 'Physical Location',
            value: address ? address.split(',')[0] : 'Unspecified',
            note: 'Headquarters / billing address',
          },
        ]}
      />

      {/* ── Error Alert ─────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="font-semibold">{error}</div>
        </div>
      )}

      {/* ── Bento Form Layout ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main Input Panel */}
        <div className="lg:col-span-2 min-w-0">
          <Panel title="Company Information & Status">
            <form onSubmit={onSubmit} className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium" htmlFor="account-name">
                    Company / Account Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="account-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Northbeam Studio Ltd."
                    className="h-9 text-xs"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Legal or operating name of the client organization.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="account-website">
                    Website URL
                  </label>
                  <Input
                    id="account-website"
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="e.g. https://northbeam.studio"
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="account-status">
                    Account Status <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="account-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full h-9 border border-input rounded-md px-3 text-xs bg-background"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium" htmlFor="account-address">
                    Physical Address / Headquarters
                  </label>
                  <Input
                    id="account-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. 100 Main St, Suite 400, San Francisco, CA"
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-border flex items-center justify-between">
                <Button asChild variant="ghost" size="sm">
                  <Link href={isEdit && accountId ? `/crm/accounts/${accountId}` : '/crm/accounts'}>
                    Cancel
                  </Link>
                </Button>
                <Button type="submit" size="sm" disabled={isLoading}>
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving…' : isEdit ? 'Save Account Changes' : 'Create Account'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Account Hierarchy Rail */}
        <div className="lg:col-span-1 space-y-4">
          <Panel title="Account Directory Role">
            <div className="p-4 space-y-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-accent" />
                <span>Relationship Anchor</span>
              </div>
              <p>
                Accounts represent business clients, partners, or vendors. Individual Contacts,
                sales Opportunities, project Workspaces, and Invoices can all be associated with
                this account.
              </p>
              <div className="pt-2 border-t border-border">
                <StatusPill tone="ok">Tenant Scoped</StatusPill>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
