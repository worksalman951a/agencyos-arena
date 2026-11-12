'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, Eye, ExternalLink, Sparkles } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import type { ExpenseResponse } from '@/lib/services/crm/expense-service';
import '@/components/crm/bento-contacts.css';

interface BentoExpensesViewProps {
  expenses: ExpenseResponse[];
  currency: string;
  categories: string[];
  summary: {
    count: number;
    totalAmount: string;
    billableAmount: string;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  filters: {
    q: string;
    category: string;
    billable: string;
    from: string;
    to: string;
    sort: string;
    page: string;
    pageSize: string;
  };
  isFiltered: boolean;
}

export function BentoExpensesView({
  expenses,
  currency,
  categories,
  summary,
  pagination,
  filters,
  isFiltered,
}: BentoExpensesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeExp = expenses[Math.min(selectedIdx, Math.max(0, expenses.length - 1))] ?? null;

  const money = (amount: string | number) =>
    formatMinorUnitsAsCurrency(Math.round(Number(amount || 0) * 100), currency);

  // Month-to-date computation from current dataset (if dated this month)
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const mtdExpenses = expenses.filter((e) => {
    const d = new Date(e.expenseDate);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });
  const mtdTotal = mtdExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const internalAmount = Math.max(
    0,
    Number(summary.totalAmount || 0) - Number(summary.billableAmount || 0)
  );

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Finance</span>
            <span>/</span>
            <span>Expenditure & Accounting</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Expenses</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {summary.count} {summary.count === 1 ? 'expense' : 'expenses'} recorded in{' '}
            <span className="font-semibold text-foreground">{currency}</span>
            {isFiltered ? ' (filtered subset)' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/finance/reports">Financial Reports</Link>
          </Button>
          <Button
            asChild
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
            size="sm"
          >
            <Link href="/finance/expenses/new" className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.4} /> New Expense
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: isFiltered ? 'Filtered Total' : 'Total Expenses',
            value: money(summary.totalAmount),
            note: `${summary.count} items recorded`,
          },
          {
            label: 'Billable Expenses',
            value: money(summary.billableAmount),
            note: 'chargeable to client accounts',
            tone: Number(summary.billableAmount) > 0 ? 'ok' : undefined,
          },
          {
            label: 'Internal Expenses',
            value: money(internalAmount),
            note: 'overhead & operating costs',
            tone: internalAmount > 0 ? 'warn' : undefined,
          },
          {
            label: 'Month-to-Date (Page)',
            value: money(mtdTotal),
            note: `${mtdExpenses.length} items logged this month`,
          },
        ]}
      />

      {/* ── Filter Form ──────────────────────────────────────────────── */}
      <form
        method="get"
        action="/finance/expenses"
        className="bento-toolbar flex-wrap gap-2 items-center"
      >
        <div className="flex-1 min-w-[200px] relative">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Search category or receipt..."
            aria-label="Search expenses"
            className="w-full bg-background border border-input rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <Search
            size={13}
            className="absolute left-2.5 top-2.5 text-muted-foreground opacity-70"
          />
        </div>

        <select
          id="category"
          name="category"
          defaultValue={filters.category}
          aria-label="Filter by category"
          className="bg-background border border-input rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          id="billable"
          name="billable"
          defaultValue={filters.billable}
          aria-label="Filter by billability"
          className="bg-background border border-input rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All Billability</option>
          <option value="true">Billable</option>
          <option value="false">Internal Only</option>
        </select>

        <select
          id="sort"
          name="sort"
          defaultValue={filters.sort}
          aria-label="Sort expenses"
          className="bg-background border border-input rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="amount_desc">Amount: high to low</option>
          <option value="amount_asc">Amount: low to high</option>
          <option value="category_asc">Category A–Z</option>
        </select>

        <Button type="submit" size="sm" className="h-8 text-xs bg-accent text-accent-foreground">
          Apply
        </Button>

        {isFiltered && (
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/finance/expenses">Clear</Link>
          </Button>
        )}
      </form>

      {/* ── Bento 3-Column Expenses Grid ─────────────────────────────── */}
      {expenses.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={isFiltered ? 'No expenses match those filters' : 'No expenses recorded yet'}
            sub="Log your first operational, travel, or client-billable expense."
            action={{
              label: 'Add Expense',
              onClick: () => {
                const link = document.createElement('a');
                link.href = '/finance/expenses/new';
                link.click();
              },
            }}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Main Table (2 Cols) */}
          <div className="lg:col-span-2 min-w-0">
            <Panel
              title={`Expense Register (${expenses.length})`}
              action={
                pagination.totalPages > 1 ? (
                  <span className="text-xs text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                ) : null
              }
            >
              <div className="bento-sales-table-head">
                <span>Category</span>
                <span>Project</span>
                <span>Date</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Billable</span>
              </div>

              <div className="divide-y divide-border/60">
                {expenses.map((exp, idx) => {
                  const isSelected = activeExp?.id === exp.id;
                  return (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {/* Category */}
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {exp.category}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          Recorded {new Date(exp.createdAt).toLocaleDateString()}
                        </div>
                      </div>

                      {/* Project */}
                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {exp.projectId ? `Project #${exp.projectId.slice(0, 8)}` : '—'}
                      </div>

                      {/* Date */}
                      <div className="text-xs text-muted-foreground truncate">
                        {new Date(exp.expenseDate).toLocaleDateString()}
                      </div>

                      {/* Amount */}
                      <div className="text-xs font-semibold text-foreground text-right font-mono">
                        {money(exp.amount)}
                      </div>

                      {/* Billable Status */}
                      <div className="text-right">
                        <StatusPill tone={exp.billable ? 'ok' : undefined}>
                          {exp.billable ? 'Billable' : 'Internal'}
                        </StatusPill>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* Quick Preview Rail (1 Col) */}
          <div className="min-w-0">
            {activeExp ? (
              <Panel
                title="Expense Inspector"
                action={
                  <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link href={`/finance/expenses/${activeExp.id}`}>
                      Open Detail <Eye size={12} className="ml-1" />
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Category
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">
                      {activeExp.category}
                    </h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Amount"
                      value={
                        <span className="font-bold text-foreground font-mono">
                          {money(activeExp.amount)}
                        </span>
                      }
                    />
                    <KeyValueRow
                      label="Expense Date"
                      value={new Date(activeExp.expenseDate).toLocaleDateString()}
                    />
                    <KeyValueRow
                      label="Classification"
                      value={
                        <StatusPill tone={activeExp.billable ? 'ok' : undefined}>
                          {activeExp.billable ? 'Client Billable' : 'Internal Overhead'}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Linked Project"
                      value={
                        activeExp.projectId ? (
                          <Link
                            href={`/projects/${activeExp.projectId}`}
                            className="text-accent hover:underline font-semibold"
                          >
                            Open Project
                          </Link>
                        ) : (
                          'No project linked'
                        )
                      }
                    />
                    <KeyValueRow
                      label="Receipt Document"
                      value={
                        activeExp.receiptUrl ? (
                          <a
                            href={activeExp.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline flex items-center gap-1 font-semibold"
                          >
                            View Receipt <ExternalLink size={11} />
                          </a>
                        ) : (
                          'No receipt attached'
                        )
                      }
                    />
                  </div>

                  <div className="border-t border-border pt-3 flex gap-2">
                    <Button asChild className="flex-1 bg-accent text-accent-foreground" size="sm">
                      <Link href={`/finance/expenses/${activeExp.id}`}>Inspect Record</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/finance/expenses/${activeExp.id}/edit`}>Edit</Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel pad>
                <div className="text-center py-8 text-muted-foreground text-xs">
                  <Sparkles size={18} className="mx-auto mb-2 opacity-50" />
                  Select an expense to preview details.
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
