'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Trash2, AlertTriangle, DollarSign } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDecimalMoney } from '@/lib/finance/decimal-utils';
import '@/components/crm/bento-contacts.css';

interface BentoExpenseFormViewProps {
  mode: 'new' | 'edit';
  expenseId?: string;
  // Form fields
  projectId: string;
  setProjectId: (val: string) => void;
  category: string;
  setCategory: (val: string) => void;
  amount: string;
  setAmount: (val: string) => void;
  expenseDate: string;
  setExpenseDate: (val: string) => void;
  receiptUrl: string;
  setReceiptUrl: (val: string) => void;
  billable: boolean;
  setBillable: (val: boolean) => void;
  // Submission
  onSubmit: (e: React.FormEvent) => void;
  onDelete?: () => void;
  isLoading: boolean;
  error?: string | null;
}

export function BentoExpenseFormView({
  mode,
  projectId,
  setProjectId,
  category,
  setCategory,
  amount,
  setAmount,
  expenseDate,
  setExpenseDate,
  receiptUrl,
  setReceiptUrl,
  billable,
  setBillable,
  onSubmit,
  onDelete,
  isLoading,
  error,
}: BentoExpenseFormViewProps) {
  const isEdit = mode === 'edit';

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link href="/finance/expenses" title="Cancel and return">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/finance/expenses" className="hover:underline">
                Finance
              </Link>
              <span>/</span>
              <Link href="/finance/expenses" className="hover:underline">
                Expenses
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Expense' : 'New Expense'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit ? `Edit Expense: ${category || 'Expense'}` : 'Log New Expense'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/finance/expenses">Cancel</Link>
          </Button>
          {isEdit && onDelete && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:bg-destructive/10"
              disabled={isLoading}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete
            </Button>
          )}
          <Button onClick={onSubmit} size="sm" disabled={isLoading}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Expense'}
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary ───────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Expense Category',
            value: category || 'Uncategorized',
            note: isEdit ? 'Existing ledger entry' : 'New operational disbursement',
          },
          {
            label: 'Expense Amount',
            value: `$${formatDecimalMoney(amount || '0')}`,
            note: 'Workspace default currency',
          },
          {
            label: 'Billing Allocation',
            value: billable ? 'Billable to Client' : 'Internal Overhead',
            note: projectId ? 'Linked to project workspace' : 'General agency cost',
            tone: billable ? 'ok' : undefined,
          },
          {
            label: 'Incurred Date',
            value: expenseDate || 'Not specified',
            note: receiptUrl ? 'Receipt attached' : 'No receipt link',
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
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Panel title="Expense Details & Accounting Classification">
            <form onSubmit={onSubmit} className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="expense-category">
                    Category <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="expense-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Software, Cloud Hosting, Travel, Subcontractor"
                    className="h-9 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="expense-amount">
                    Amount <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="expense-amount"
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="h-9 text-xs text-right font-mono"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="expense-date">
                    Incurred Date <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="expense-date"
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="expense-project-id">
                    Associated Project ID (Optional)
                  </label>
                  <Input
                    id="expense-project-id"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="Project CUID"
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium" htmlFor="expense-receipt-url">
                    Receipt or Proof URL (Optional)
                  </label>
                  <Input
                    id="expense-receipt-url"
                    type="url"
                    value={receiptUrl}
                    onChange={(e) => setReceiptUrl(e.target.value)}
                    placeholder="https://storage.example.com/receipts/..."
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium">
                    <input
                      type="checkbox"
                      id="expense-billable"
                      checked={billable}
                      onChange={(e) => setBillable(e.target.checked)}
                      className="rounded border-input text-accent bg-background h-4 w-4"
                    />
                    <span>Billable Expense (rechargeable to client invoice)</span>
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-border flex items-center justify-between">
                <Button asChild variant="ghost" size="sm">
                  <Link href="/finance/expenses">Cancel</Link>
                </Button>
                <Button type="submit" size="sm" disabled={isLoading}>
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Expense'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Financial Rules & Currency Advisory Rail (1 col) */}
        <div className="lg:col-span-1 space-y-4">
          <Panel title="Expense Currency Notice">
            <div className="p-4 space-y-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-accent" />
                <span>Denomination Behavior</span>
              </div>
              <p>
                Expense items reflect amounts in the active organization&apos;s default currency.
                Changing your workspace currency relabels expense totals without applying historical
                exchange rate conversions.
              </p>
              <div className="pt-2 border-t border-border space-y-1">
                <div className="text-foreground font-semibold">Billable Recharges</div>
                <p>
                  Marking an expense as billable allows it to be referenced when assembling client
                  invoices and project profitability summaries.
                </p>
              </div>
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
