'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Calendar, CreditCard, Clock, CheckCircle2 } from 'lucide-react';
import { Panel, KeyValueRow, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { ExportPdfButton } from '@/components/invoices/export-pdf-button';
import { sumDecimalAmounts, formatDecimalMoney } from '@/lib/finance/decimal-utils';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';
import Decimal from 'decimal.js';
import '@/components/crm/bento-contacts.css';

interface BentoInvoiceRecordViewProps {
  invoice: InvoiceResponse;
  canUpdate: boolean;
  isEditable: boolean;
}

export function BentoInvoiceRecordView({ invoice, isEditable }: BentoInvoiceRecordViewProps) {
  const clientFullName = invoice.client
    ? `${invoice.client.firstName ?? ''} ${invoice.client.lastName ?? ''}`.trim() ||
      'Unnamed Client'
    : 'Unnamed Client';

  // Compute total paid and outstanding balance safely using Decimal
  const totalPaidStr = sumDecimalAmounts(invoice.payments?.map((p) => p.amount) ?? []);
  const grossTotal = new Decimal(invoice.total || 0);
  const paidTotal = new Decimal(totalPaidStr || 0);
  const balanceDecimal = Decimal.max(0, grossTotal.minus(paidTotal));
  const balanceStr = balanceDecimal.toFixed(2);
  const isSettled = invoice.status === 'paid' || balanceDecimal.isZero();

  const getStatusTone = (status: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (status.toLowerCase()) {
      case 'paid':
        return 'ok';
      case 'sent':
        return 'warn';
      case 'overdue':
        return 'danger';
      default:
        return undefined;
    }
  };

  return (
    <div className="bento-crm space-y-6">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
            <Link href="/finance/invoices" aria-label="Back to invoices">
              <ArrowLeft size={14} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Invoices</span>
              <span>/</span>
              <span>#{invoice.number}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {invoice.title}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportPdfButton invoiceId={invoice.id} />
          {isEditable && (
            <Button asChild variant="outline" size="sm" className="h-9 text-xs">
              <Link href={`/finance/invoices/${invoice.id}/edit`}>Edit</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="h-9 text-xs">
            <Link href="/finance/invoices">Back</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Gross Billed',
            value: `${invoice.currency} ${formatDecimalMoney(invoice.total)}`,
            note: `${invoice.items.length} line items`,
          },
          {
            label: 'Paid to Date',
            value: `${invoice.currency} ${formatDecimalMoney(totalPaidStr)}`,
            note: `${invoice.payments.length} payments recorded`,
            tone: paidTotal.greaterThan(0) ? 'ok' : undefined,
          },
          {
            label: 'Balance Due',
            value: `${invoice.currency} ${formatDecimalMoney(balanceStr)}`,
            note: isSettled
              ? 'settled in full'
              : invoice.dueDate
                ? `due ${new Date(invoice.dueDate).toLocaleDateString()}`
                : 'unsettled balance',
            tone: isSettled ? 'ok' : 'warn',
          },
          {
            label: 'Status',
            value: invoice.status.toUpperCase(),
            tone: getStatusTone(invoice.status),
          },
        ]}
      />

      {/* ── Bento 2-Column Content Layout ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Line Items & Ledger (2 cols) */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* Line Items Table */}
          <Panel title={`Line Items (${invoice.items.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Unit Price</th>
                    <th className="py-2.5 px-3 text-right">Tax Rate</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {invoice.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-muted-foreground">
                        No line items defined on this invoice.
                      </td>
                    </tr>
                  ) : (
                    invoice.items.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3 font-medium text-foreground">
                          {item.description}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">{item.quantity}</td>
                        <td className="py-3 px-3 text-right font-mono">
                          {invoice.currency} {formatDecimalMoney(item.unitPrice)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">{item.taxRate}%</td>
                        <td className="py-3 px-3 text-right font-semibold font-mono text-foreground">
                          {invoice.currency} {formatDecimalMoney(item.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Financial Totals Reconciliation */}
            <div className="p-4 bg-muted/20 border-t border-border flex justify-end">
              <div className="w-64 space-y-2 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-mono text-foreground">
                    {invoice.currency} {formatDecimalMoney(invoice.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax Total</span>
                  <span className="font-mono text-foreground">
                    {invoice.currency} {formatDecimalMoney(invoice.tax)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold text-foreground border-t border-border pt-2">
                  <span>Invoice Total</span>
                  <span className="font-mono">
                    {invoice.currency} {formatDecimalMoney(invoice.total)}
                  </span>
                </div>
              </div>
            </div>
          </Panel>

          {/* Payment History */}
          <Panel title={`Recorded Payments (${invoice.payments.length})`}>
            {invoice.payments.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-xs space-y-1">
                <CreditCard size={24} className="mx-auto mb-1 opacity-40" />
                <p className="font-semibold text-foreground">No payments recorded</p>
                <p>
                  Payments recorded against this invoice will appear here with method and
                  transaction reference.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3">Reference</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                      <th className="py-2.5 px-3 text-right">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {invoice.payments.map((p, idx) => (
                      <tr key={idx} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-3 font-mono">
                          {p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-foreground">{p.method}</td>
                        <td className="py-2.5 px-3 font-mono text-muted-foreground">
                          {p.reference || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold font-mono text-emerald-700">
                          {invoice.currency} {formatDecimalMoney(p.amount)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted-foreground">
                          {p.recordedBy || 'System'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Notes */}
          {invoice.notes && (
            <Panel title="Commercial Terms & Notes">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {invoice.notes}
              </p>
            </Panel>
          )}
        </div>

        {/* Right Column: Commercial & Billing Context (1 col) */}
        <div className="space-y-6 min-w-0">
          <Panel title="Billing Relationship">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Client Contact"
                value={
                  invoice.clientId ? (
                    <Link
                      href={`/crm/contacts/${invoice.clientId}`}
                      className="text-accent hover:underline font-semibold"
                    >
                      {clientFullName}
                    </Link>
                  ) : (
                    'No client linked'
                  )
                }
              />
              <KeyValueRow
                label="Due Date"
                value={
                  invoice.dueDate ? (
                    <span className="flex items-center gap-1 font-semibold">
                      <Calendar size={13} className="text-muted-foreground" />
                      {new Date(invoice.dueDate).toLocaleDateString()}
                    </span>
                  ) : (
                    'No due date'
                  )
                }
              />
              <KeyValueRow
                label="Currency Code"
                value={<span className="font-mono font-semibold">{invoice.currency}</span>}
              />
              <KeyValueRow
                label="Created Date"
                value={new Date(invoice.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Document Status"
                value={
                  <StatusPill tone={getStatusTone(invoice.status)}>{invoice.status}</StatusPill>
                }
              />
            </div>
          </Panel>

          <Panel title="Reconciliation Status">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Total Outstanding"
                value={
                  <span className="font-bold font-mono text-foreground">
                    {invoice.currency} {formatDecimalMoney(balanceStr)}
                  </span>
                }
              />
              <KeyValueRow
                label="Settlement State"
                value={
                  isSettled ? (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      <CheckCircle2 size={13} /> Paid in Full
                    </span>
                  ) : (
                    <span className="text-amber-700 font-semibold flex items-center gap-1">
                      <Clock size={13} /> Payment Due
                    </span>
                  )
                }
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
