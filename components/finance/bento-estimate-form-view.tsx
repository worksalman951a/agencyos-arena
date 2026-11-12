'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDecimalMoney } from '@/lib/finance/decimal-utils';
import '@/components/crm/bento-contacts.css';

interface ContactOption {
  id: string;
  firstName: string | null;
  lastName: string;
  email: string | null;
}

interface BentoEstimateFormViewProps {
  mode: 'new' | 'edit';
  estimateId?: string;
  // Form fields
  clientId: string;
  setClientId: (val: string) => void;
  contacts: ContactOption[];
  loadingInit?: boolean;
  number: string;
  setNumber: (val: string) => void;
  status: string;
  setStatus: (val: string) => void;
  savedStatus?: string;
  total: string;
  setTotal: (val: string) => void;
  currency: string;
  setCurrency: (val: string) => void;
  validUntil: string;
  setValidUntil: (val: string) => void;
  notes: string;
  setNotes: (val: string) => void;
  // Submission
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error?: string | null;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'PKR', 'INR', 'AED', 'SGD', 'JPY'];

export function BentoEstimateFormView({
  mode,
  estimateId,
  clientId,
  setClientId,
  contacts,
  loadingInit = false,
  number,
  setNumber,
  status,
  setStatus,
  savedStatus = 'draft',
  total,
  setTotal,
  currency,
  setCurrency,
  validUntil,
  setValidUntil,
  notes,
  setNotes,
  onSubmit,
  isLoading,
  error,
}: BentoEstimateFormViewProps) {
  const isEdit = mode === 'edit';
  const isLocked = isEdit && !['draft', 'sent'].includes(savedStatus);

  const selectedContact = contacts.find((c) => c.id === clientId);
  const contactName = selectedContact
    ? `${selectedContact.firstName ?? ''} ${selectedContact.lastName}`.trim()
    : clientId || 'Direct Client';

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link
              href={
                isEdit && estimateId ? `/finance/estimates/${estimateId}` : '/finance/estimates'
              }
              title="Cancel and return"
            >
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/finance/estimates" className="hover:underline">
                Finance
              </Link>
              <span>/</span>
              <Link href="/finance/estimates" className="hover:underline">
                Estimates
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Estimate' : 'New Estimate'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Estimate: ${number || 'Estimate'}` : 'New Cost Estimate'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              href={
                isEdit && estimateId ? `/finance/estimates/${estimateId}` : '/finance/estimates'
              }
            >
              Cancel
            </Link>
          </Button>
          {!isLocked && (
            <Button onClick={onSubmit} size="sm" disabled={isLoading}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {isLoading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Estimate'}
            </Button>
          )}
        </div>
      </div>

      {/* ── StatStrip Summary ───────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Estimate Number',
            value: number || 'EST-DRAFT',
            note: isEdit ? 'Existing quote record' : 'Proposed quotation identifier',
          },
          {
            label: 'Target Prospect / Client',
            value: contactName,
            note: clientId ? 'Linked CRM Contact' : 'No contact specified',
          },
          {
            label: 'Status & Term',
            value: `${status.toUpperCase()} (${currency})`,
            note: validUntil ? `Valid until ${validUntil}` : 'No expiry specified',
            tone: status === 'accepted' ? 'ok' : status === 'sent' ? 'warn' : undefined,
          },
          {
            label: 'Estimated Value',
            value: `${currency} ${formatDecimalMoney(total || '0')}`,
            note: 'Estimated quote value',
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

      {/* ── Locked State Alert ──────────────────────────────────────── */}
      {isLocked && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-5 text-xs text-amber-900 dark:text-amber-200 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Estimate is {savedStatus.toUpperCase()} (Read Only)</span>
          </div>
          <p>
            Estimates in <strong>{savedStatus}</strong> status are locked to preserve historical
            record integrity.
          </p>
          <div className="flex items-center gap-2 pt-1">
            {savedStatus === 'accepted' && estimateId && (
              <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Link href={`/finance/estimates/${estimateId}/convert`}>Convert to Invoice</Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={`/finance/estimates/${estimateId}`}>Back to Estimate</Link>
            </Button>
          </div>
        </div>
      )}

      {/* ── Bento Form Layout ────────────────────────────────────────── */}
      {!isLocked && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-6 min-w-0">
            <Panel title="Estimate Details & Prospect Association">
              <form onSubmit={onSubmit} className="p-5 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="estimate-client">
                      Client Contact <span className="text-destructive">*</span>
                    </label>
                    {contacts.length > 0 ? (
                      <select
                        id="estimate-client"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        disabled={loadingInit}
                        className="w-full border border-input rounded-md px-3 text-xs h-9 bg-background"
                        required
                      >
                        <option value="">Select a client contact…</option>
                        {contacts.map((c) => {
                          const fullName = `${c.firstName ?? ''} ${c.lastName}`.trim() || 'Unnamed';
                          return (
                            <option key={c.id} value={c.id}>
                              {c.email ? `${fullName} (${c.email})` : fullName}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <Input
                        id="estimate-client"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        placeholder="Client contact CUID"
                        className="h-9 text-xs"
                        required
                      />
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="estimate-number">
                      Estimate Number <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="estimate-number"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      placeholder="e.g. EST-2026-0001"
                      className="h-9 text-xs font-mono"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="estimate-status">
                      Status <span className="text-destructive">*</span>
                    </label>
                    <select
                      id="estimate-status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full border border-input rounded-md px-3 text-xs h-9 bg-background"
                    >
                      {(!isEdit || savedStatus === 'draft') && <option value="draft">Draft</option>}
                      <option value="sent">Sent</option>
                      <option value="accepted">Accepted</option>
                      {isEdit && <option value="rejected">Rejected</option>}
                      {isEdit && <option value="expired">Expired</option>}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="estimate-total">
                      Total Quoted Amount <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="estimate-total"
                      type="number"
                      step="0.01"
                      min="0"
                      value={total}
                      onChange={(e) => setTotal(e.target.value)}
                      placeholder="0.00"
                      className="h-9 text-xs text-right font-mono"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="estimate-currency">
                      Currency <span className="text-destructive">*</span>
                    </label>
                    <select
                      id="estimate-currency"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full border border-input rounded-md px-3 text-xs h-9 bg-background"
                    >
                      {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map(
                        (c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="estimate-valid-until">
                      Valid Until Date
                    </label>
                    <Input
                      id="estimate-valid-until"
                      type="date"
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-medium" htmlFor="estimate-notes">
                      Scope Summary & Terms
                    </label>
                    <textarea
                      id="estimate-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={4}
                      placeholder="Scope of work, deliverables, payment milestones, validity period…"
                      className="w-full border border-input rounded-md p-3 text-xs bg-background"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-between">
                  <Button asChild variant="ghost" size="sm">
                    <Link
                      href={
                        isEdit && estimateId
                          ? `/finance/estimates/${estimateId}`
                          : '/finance/estimates'
                      }
                    >
                      Cancel
                    </Link>
                  </Button>
                  <Button type="submit" size="sm" disabled={isLoading}>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    {isLoading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Estimate'}
                  </Button>
                </div>
              </form>
            </Panel>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <Panel title="Estimate Lifecycle & Conversion">
              <div className="p-4 space-y-3 text-xs text-muted-foreground">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Conversion Pathway</span>
                </div>
                <p>
                  Accepted estimates can be converted into official sales Invoices. Once converted,
                  the estimate is locked against further edits.
                </p>
                <div className="pt-2 border-t border-border space-y-1">
                  <div className="text-foreground font-semibold">Pricing Protection</div>
                  <p>
                    Quotation totals and valid-until dates protect both your agency and client
                    expectations.
                  </p>
                </div>
                <div className="pt-2 border-t border-border">
                  <StatusPill tone="ok">Tenant Protected</StatusPill>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
