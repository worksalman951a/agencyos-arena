'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, AlertTriangle, Shield } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface AccountOption {
  id: string;
  name: string;
}

interface BentoContactFormViewProps {
  mode: 'new' | 'edit';
  contactId?: string;
  // Form fields
  firstName: string;
  setFirstName: (val: string) => void;
  lastName: string;
  setLastName: (val: string) => void;
  email: string;
  setEmail: (val: string) => void;
  phone: string;
  setPhone: (val: string) => void;
  accountId: string;
  setAccountId: (val: string) => void;
  status: string;
  setStatus: (val: string) => void;
  source: string;
  setSource: (val: string) => void;
  // Accounts
  accounts: AccountOption[];
  accountsLoading: boolean;
  // Submission
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
}

export function BentoContactFormView({
  mode,
  contactId,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  phone,
  setPhone,
  accountId,
  setAccountId,
  status,
  setStatus,
  source,
  setSource,
  accounts,
  accountsLoading,
  onSubmit,
  isLoading,
  error,
  fieldErrors,
}: BentoContactFormViewProps) {
  const isEdit = mode === 'edit';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'New Contact';

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link
              href={isEdit && contactId ? `/crm/contacts/${contactId}` : '/crm/contacts'}
              title="Cancel and return"
            >
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/contacts" className="hover:underline">
                CRM
              </Link>
              <span>/</span>
              <Link href="/crm/contacts" className="hover:underline">
                Contacts
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Contact' : 'New Contact'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit: ${fullName}` : 'Register New Contact'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={isEdit && contactId ? `/crm/contacts/${contactId}` : '/crm/contacts'}>
              Cancel
            </Link>
          </Button>
          <Button onClick={onSubmit} size="sm" disabled={isLoading}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Contact'}
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary ───────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Contact Identity',
            value: fullName,
            note: isEdit ? 'Updating existing person' : 'New CRM profile',
          },
          {
            label: 'Primary Account',
            value: accounts.find((a) => a.id === accountId)?.name || 'Direct Individual',
            note: accountId ? 'Linked organization' : 'No account affiliation',
          },
          {
            label: 'Lifecycle Status',
            value: status.toUpperCase(),
            note: 'Operational record state',
            tone: status === 'active' ? 'ok' : undefined,
          },
          {
            label: 'Lead Source',
            value: source || 'Direct Intake',
            note: 'Original acquisition channel',
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
          <Panel title="Personal Details & Communications">
            <form onSubmit={onSubmit} className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="contact-first-name">
                    First Name
                  </label>
                  <Input
                    id="contact-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="e.g. Jane"
                    className="h-9 text-xs"
                  />
                  {fieldErrors.firstName && (
                    <p className="text-[11px] text-destructive">{fieldErrors.firstName}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="contact-last-name">
                    Last Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="contact-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="e.g. Doe"
                    className="h-9 text-xs"
                    required
                  />
                  {fieldErrors.lastName && (
                    <p className="text-[11px] text-destructive">{fieldErrors.lastName}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="contact-email">
                    Email Address
                  </label>
                  <Input
                    id="contact-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. jane.doe@acme.com"
                    className="h-9 text-xs"
                  />
                  {fieldErrors.email && (
                    <p className="text-[11px] text-destructive">{fieldErrors.email}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="contact-phone">
                    Phone Number
                  </label>
                  <Input
                    id="contact-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +1 (555) 019-2834"
                    className="h-9 text-xs"
                  />
                  {fieldErrors.phone && (
                    <p className="text-[11px] text-destructive">{fieldErrors.phone}</p>
                  )}
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium" htmlFor="contact-account-id">
                    Associated Organization / Account
                  </label>
                  <select
                    id="contact-account-id"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    disabled={accountsLoading}
                    className="w-full h-9 border border-input rounded-md px-3 text-xs bg-background disabled:opacity-60"
                  >
                    <option value="">No Account (Individual Client / Freelancer)</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground">
                    Links this contact to a business account in your organization directory.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="contact-status">
                    Contact Status <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="contact-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full h-9 border border-input rounded-md px-3 text-xs bg-background"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="contact-source">
                    Acquisition Source
                  </label>
                  <Input
                    id="contact-source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="e.g. Inbound Form, Referral"
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-border flex items-center justify-between">
                <Button asChild variant="ghost" size="sm">
                  <Link href={isEdit && contactId ? `/crm/contacts/${contactId}` : '/crm/contacts'}>
                    Cancel
                  </Link>
                </Button>
                <Button type="submit" size="sm" disabled={isLoading}>
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving…' : isEdit ? 'Save Contact Changes' : 'Create Contact'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Privacy & Governance Rail */}
        <div className="lg:col-span-1 space-y-4">
          <Panel title="Privacy & Masking Rules">
            <div className="p-4 space-y-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-accent" />
                <span>Client Portal Masking</span>
              </div>
              <p>
                AgencyOS enforces field-level masking for external client portal users. Sensitive
                email and telephone numbers are concealed unless explicitly granted by your
                organization administrator.
              </p>
              <div className="pt-2 border-t border-border">
                <StatusPill tone="ok">Tenant Protected</StatusPill>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
