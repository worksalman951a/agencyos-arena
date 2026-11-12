/**
 * AgencyOS New Expense page.
 * Client component form for creating a new expense item.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoExpenseFormView } from '@/components/finance/bento-expense-form-view';

export default function NewExpensePage() {
  const isBento = useBentoShell();
  const router = useRouter();
  const [projectId, setProjectId] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [billable, setBillable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e?.preventDefault) e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/v1/finance/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectId || undefined,
          category,
          amount,
          expenseDate: `${expenseDate}T00:00:00`,
          receiptUrl: receiptUrl || undefined,
          billable,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err as { error?: string }).error || 'Failed to create expense';
        setError(msg);
        throw new Error(msg);
      }

      const data = await res.json();
      toast.success('Expense created');
      router.push(`/finance/expenses/${data.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (isBento) {
    return (
      <BentoExpenseFormView
        mode="new"
        projectId={projectId}
        setProjectId={setProjectId}
        category={category}
        setCategory={setCategory}
        amount={amount}
        setAmount={setAmount}
        expenseDate={expenseDate}
        setExpenseDate={setExpenseDate}
        receiptUrl={receiptUrl}
        setReceiptUrl={setReceiptUrl}
        billable={billable}
        setBillable={setBillable}
        onSubmit={handleSubmit}
        isLoading={loading}
        error={error}
      />
    );
  }

  // Legacy fallback view
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">New Expense</h1>
        <Link
          href="/finance/expenses"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Project ID</label>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Project CUID (optional)"
              className="border border-input rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Software, Travel, Materials"
              className="border border-input rounded-md px-3 py-2 text-sm"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Amount</label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="border border-input rounded-md px-3 py-2 text-sm text-right"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Expense Date</label>
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="border border-input rounded-md px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              Billable
              <input
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
                className="rounded border-input text-accent bg-background"
              />
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Receipt URL</label>
          <input
            type="text"
            value={receiptUrl}
            onChange={(e) => setReceiptUrl(e.target.value)}
            placeholder="https://..."
            className="border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {loading ? 'Creating...' : 'Create Expense'}
        </button>
      </form>
    </div>
  );
}
