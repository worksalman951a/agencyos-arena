'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, Shield, AlertTriangle, FileText } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface ConvertedInvoice {
  invoiceId: string;
  invoiceNumber: string;
}

interface BentoConvertEstimateViewProps {
  estimate: {
    id: string;
    number: string;
    status: string;
  };
  invoiceTitle: string;
  setInvoiceTitle: (val: string) => void;
  dueDate: string;
  setDueDate: (val: string) => void;
  onConvert: (e: React.FormEvent) => void;
  converting: boolean;
  converted: ConvertedInvoice | null;
}

export function BentoConvertEstimateView({
  estimate,
  invoiceTitle,
  setInvoiceTitle,
  dueDate,
  setDueDate,
  onConvert,
  converting,
  converted,
}: BentoConvertEstimateViewProps) {
  const isAccepted = estimate.status === 'accepted';

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link href={`/finance/estimates/${estimate.id}`} title="Cancel and return to estimate">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/finance/estimates" className="hover:underline">
                Finance
              </Link>
              <span>/</span>
              <Link href={`/finance/estimates/${estimate.id}`} className="hover:underline">
                Estimate #{estimate.number}
              </Link>
              <span>/</span>
              <span>Convert</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              Convert Estimate to Invoice
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/finance/estimates/${estimate.id}`}>Back to Estimate</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary ───────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Source Estimate',
            value: estimate.number,
            note: 'Original accepted quotation',
          },
          {
            label: 'Estimate Status',
            value: estimate.status.toUpperCase(),
            note: isAccepted ? 'Eligible for conversion' : 'Ineligible status',
            tone: isAccepted ? 'ok' : 'danger',
          },
          {
            label: 'Target Document',
            value: converted ? `Invoice ${converted.invoiceNumber}` : 'Draft Invoice',
            note: 'Sequence allocated upon creation',
            tone: converted ? 'ok' : undefined,
          },
          {
            label: 'Conversion State',
            value: converted ? 'Completed' : 'Pending Confirmation',
            note: converted ? 'Estimate status: Converted' : 'Awaiting conversion action',
          },
        ]}
      />

      {/* ── Ineligible Alert ───────────────────────────────────────── */}
      {!isAccepted && !converted && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-5 text-xs text-amber-900 dark:text-amber-200 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Cannot Convert Estimate</span>
          </div>
          <p>
            Only accepted estimates can be converted to invoices. This estimate is currently{' '}
            <strong>{estimate.status}</strong>.
          </p>
          <div className="pt-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/finance/estimates/${estimate.id}`}>Back to Estimate</Link>
            </Button>
          </div>
        </div>
      )}

      {/* ── Converted Success View ──────────────────────────────────── */}
      {converted && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-6">
            <Panel title="Invoice Generated Successfully">
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-base">
                  <CheckCircle2 size={18} />
                  <span>Invoice Created from Estimate #{estimate.number}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  The estimate has been transitioned to <strong>converted</strong> status and its
                  commercial lines transferred into a new draft invoice.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-3">
                  <div className="border border-border rounded-lg p-3 bg-muted/20">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Allocated Invoice Number
                    </div>
                    <div className="text-lg font-mono font-bold text-foreground mt-1">
                      {converted.invoiceNumber}
                    </div>
                  </div>
                  <div className="border border-border rounded-lg p-3 bg-muted/20">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Lifecycle Status
                    </div>
                    <div className="text-lg font-bold text-foreground mt-1">Draft</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <Button asChild size="sm">
                    <Link href={`/finance/invoices/${converted.invoiceId}`}>
                      Open Generated Invoice <ArrowRight size={14} className="ml-1" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/finance/invoices">View All Invoices</Link>
                  </Button>
                </div>
              </div>
            </Panel>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <Panel title="Audit & Traceability">
              <div className="p-4 space-y-3 text-xs text-muted-foreground">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-accent" />
                  <span>Immutable Conversion</span>
                </div>
                <p>
                  The estimate is permanently locked. All adjustments to line items and final
                  billing must now be made directly on the generated invoice.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ── Active Conversion Form ──────────────────────────────────── */}
      {isAccepted && !converted && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-6 min-w-0">
            <Panel title={`Convert Estimate #${estimate.number}`}>
              <form onSubmit={onConvert} className="p-5 space-y-5">
                <p className="text-xs text-muted-foreground">
                  Generate an official sales invoice from this accepted estimate. The invoice will
                  be initialized in <strong>Draft</strong> status and assigned a sequenced invoice
                  number automatically.
                </p>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="convert-invoice-title">
                      Invoice Title <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="convert-invoice-title"
                      value={invoiceTitle}
                      onChange={(e) => setInvoiceTitle(e.target.value)}
                      placeholder="e.g. Invoice for Estimate EST-2026-0001"
                      className="h-9 text-xs"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="convert-invoice-due-date">
                      Due Date (Optional)
                    </label>
                    <Input
                      id="convert-invoice-due-date"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-between">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/finance/estimates/${estimate.id}`}>Cancel</Link>
                  </Button>
                  <Button type="submit" size="sm" disabled={converting}>
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    {converting ? 'Converting…' : 'Convert to Invoice'}
                  </Button>
                </div>
              </form>
            </Panel>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <Panel title="Transaction Guarantees">
              <div className="p-4 space-y-3 text-xs text-muted-foreground">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-accent" />
                  <span>Atomicity & Numbering</span>
                </div>
                <p>
                  Conversion is executed within an atomic database transaction. An invoice sequence
                  number is claimed from your organization settings and linked to the source
                  estimate.
                </p>
                <div className="pt-2 border-t border-border">
                  <StatusPill tone="ok">Idempotent Operation</StatusPill>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
