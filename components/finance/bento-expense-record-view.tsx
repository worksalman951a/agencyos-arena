'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, ExternalLink, CheckCircle2 } from 'lucide-react';
import { Panel, KeyValueRow, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import type { ExpenseResponse } from '@/lib/services/crm/expense-service';
import '@/components/crm/bento-contacts.css';

interface BentoExpenseRecordViewProps {
  expense: ExpenseResponse & { currency: string };
}

export function BentoExpenseRecordView({ expense }: BentoExpenseRecordViewProps) {
  const isUnresolved = expense.isHistoricalUnresolved;
  const money = (amount: string | number) =>
    isUnresolved
      ? `${amount} (Unresolved Currency)`
      : formatMinorUnitsAsCurrency(Math.round(Number(amount || 0) * 100), expense.currency);

  return (
    <div className="bento-crm space-y-6">
      {/* ── Breadcrumb & Top Action Header ──────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
            <Link href="/finance/expenses" aria-label="Back to expenses">
              <ArrowLeft size={14} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Expenses</span>
              <span>/</span>
              <span>{expense.category}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              Expense: {expense.category}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-9 text-xs">
            <Link href={`/finance/expenses/${expense.id}/edit`}>Edit Expense</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-9 text-xs">
            <Link href="/finance/expenses">Back to Expenses</Link>
          </Button>
        </div>
      </div>

      {isUnresolved && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200">
          <strong>Historical Record Notice:</strong> This legacy expense does not have a verified
          currency code. It requires an administrative reconciliation action to confirm the original
          transaction currency without altering ledger history.
        </div>
      )}

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Recorded Amount',
            value: money(expense.amount),
            note: isUnresolved
              ? 'unresolved historical currency'
              : `transaction currency (${expense.currency})`,
            tone: isUnresolved ? 'warn' : undefined,
          },
          {
            label: 'Billing Classification',
            value: expense.billable ? 'BILLABLE' : 'INTERNAL',
            tone: expense.billable ? 'ok' : undefined,
            note: expense.billable ? 'client billable charge' : 'internal operational cost',
          },
          {
            label: 'Expense Date',
            value: new Date(expense.expenseDate).toLocaleDateString(),
            note: 'incurred date',
          },
          {
            label: 'Recorded In System',
            value: new Date(expense.createdAt).toLocaleDateString(),
            note: 'audit logged',
          },
        ]}
      />

      {/* ── Bento 2-Column Content Layout ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Commercial Context & Ledger (2 cols) */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Panel title="Expenditure Ledger & Classification">
            <div className="p-6 bg-muted/10 border rounded-lg space-y-4">
              <div className="flex items-baseline justify-between border-b pb-4">
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                    Incurred Charge
                  </span>
                  <div className="text-2xl font-bold font-mono text-foreground mt-1">
                    {money(expense.amount)}
                  </div>
                </div>
                <div>
                  <StatusPill tone={expense.billable ? 'ok' : undefined}>
                    {expense.billable ? 'Client Billable' : 'Operating Overhead'}
                  </StatusPill>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground block">Category Classification</span>
                  <span className="font-semibold text-foreground mt-0.5 block">
                    {expense.category}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Incurred Date</span>
                  <span className="font-semibold text-foreground mt-0.5 block">
                    {new Date(expense.expenseDate).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </Panel>

          {/* Receipt Attachment Panel */}
          <Panel title="Receipt Documentation">
            {expense.receiptUrl ? (
              <div className="p-4 rounded-lg border bg-card flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-accent/10 text-accent">
                    <FileText size={20} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground">Attached Document</div>
                    <div className="text-[11px] text-muted-foreground truncate max-w-sm">
                      {expense.receiptUrl}
                    </div>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                  <a href={expense.receiptUrl} target="_blank" rel="noopener noreferrer">
                    Open Attachment <ExternalLink size={12} className="ml-1" />
                  </a>
                </Button>
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-muted-foreground space-y-1">
                <FileText size={24} className="mx-auto mb-1 opacity-40" />
                <p className="font-semibold text-foreground">No digital receipt attached</p>
                <p>This expense record does not have an external URL or receipt link attached.</p>
              </div>
            )}
          </Panel>
        </div>

        {/* Right Column: Relationships (1 col) */}
        <div className="space-y-6 min-w-0">
          <Panel title="Project & Workspace Context">
            <div className="space-y-3 text-xs">
              <KeyValueRow
                label="Linked Project"
                value={
                  expense.projectId ? (
                    <Link
                      href={`/projects/${expense.projectId}`}
                      className="text-accent hover:underline font-semibold"
                    >
                      Project #{expense.projectId.slice(0, 8)}
                    </Link>
                  ) : (
                    'No project associated'
                  )
                }
              />
              <KeyValueRow
                label="Denominated Currency"
                value={
                  expense.isHistoricalUnresolved ? (
                    <span className="text-amber-600 dark:text-amber-400 font-semibold">
                      Unresolved (Historical Record)
                    </span>
                  ) : (
                    <span className="font-mono font-semibold">{expense.currency}</span>
                  )
                }
              />
              <KeyValueRow
                label="Audit Created"
                value={new Date(expense.createdAt).toLocaleDateString()}
              />
              <KeyValueRow
                label="Status"
                value={
                  <span className="text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 size={13} /> Recorded in Ledger
                  </span>
                }
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
