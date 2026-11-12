/**
 * AgencyOS Edit Expense page.
 * Client component form for editing an existing expense item.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoExpenseFormView } from '@/components/finance/bento-expense-form-view';

export default function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const isBento = useBentoShell();
  const router = useRouter();
  const [id, setId] = useState<string>('');
  const [projectId, setProjectId] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [billable, setBillable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then(async ({ id: pid }) => {
      setId(pid);
      try {
        const res = await fetch(`/api/v1/finance/expenses/${pid}`);
        if (!res.ok) throw new Error('Failed to load expense');
        const data = await res.json();
        setProjectId(data.projectId || '');
        setCategory(data.category || '');
        setAmount(data.amount || '');
        setExpenseDate(
          data.expenseDate ? new Date(data.expenseDate).toISOString().split('T')[0] : ''
        );
        setReceiptUrl(data.receiptUrl || '');
        setBillable(data.billable || false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }, [params]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e?.preventDefault) e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/finance/expenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectId || undefined,
          category: category || undefined,
          amount: amount || undefined,
          expenseDate: expenseDate ? `${expenseDate}T00:00:00` : undefined,
          receiptUrl: receiptUrl || undefined,
          billable,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err as { error?: string }).error || 'Failed to update expense';
        setError(msg);
        throw new Error(msg);
      }

      toast.success('Expense updated');
      router.push(`/finance/expenses`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/v1/finance/expenses/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete expense');
      toast.success('Expense deleted');
      router.push(`/finance/expenses`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (isBento) {
    return (
      <BentoExpenseFormView
        mode="edit"
        expenseId={id}
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
        onDelete={handleDelete}
        isLoading={saving}
        error={error}
      />
    );
  }

  // Legacy fallback view
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit Expense</h1>
        <div className="flex gap-2">
          <Link
            href="/finance/expenses"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Cancel
          </Link>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90"
          >
            Delete
          </button>
        </div>
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
          disabled={saving}
          className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
