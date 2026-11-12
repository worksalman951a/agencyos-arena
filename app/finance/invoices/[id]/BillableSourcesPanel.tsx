'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type BillableSource = { id: string; description: string; amount: string; expenseDate?: string };
type SourceList = { expenses: BillableSource[]; changeOrders: BillableSource[] };

export function BillableSourcesPanel({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [sources, setSources] = useState<SourceList>({ expenses: [], changeOrders: [] });
  const [selectedExpenses, setSelectedExpenses] = useState<string[]>([]);
  const [selectedChangeOrders, setSelectedChangeOrders] = useState<string[]>([]);
  const [taxRate, setTaxRate] = useState('0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/crm/invoices/${encodeURIComponent(invoiceId)}/billable-sources`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not load billable sources');
        if (active) setSources(body as SourceList);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(error instanceof Error ? error.message : 'Could not load billable sources');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [invoiceId]);

  const toggle = (id: string, group: 'expense' | 'changeOrder') => {
    const setter = group === 'expense' ? setSelectedExpenses : setSelectedChangeOrders;
    setter((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  };

  async function addSelected() {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(
        `/api/v1/crm/invoices/${encodeURIComponent(invoiceId)}/billable-sources`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expenses: selectedExpenses.map((id) => ({ id, taxRate })),
            changeOrders: selectedChangeOrders.map((id) => ({ id, taxRate })),
          }),
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not add billable sources');
      setSelectedExpenses([]);
      setSelectedChangeOrders([]);
      setSources({ expenses: [], changeOrders: [] });
      setMessage('Selected sources added to the draft invoice.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add billable sources');
    } finally {
      setSaving(false);
    }
  }

  const hasSelection = selectedExpenses.length + selectedChangeOrders.length > 0;
  return (
    <section
      className="rounded-md border bg-background p-4 space-y-4"
      aria-label="Billable project sources"
    >
      <div>
        <h2 className="text-lg font-semibold">Project expenses and change orders</h2>
        <p className="text-sm text-muted-foreground">
          Explicitly add eligible unbilled sources to this draft invoice. Added sources remain
          linked for financial history.
        </p>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading eligible sources…</p> : null}
      {!loading && sources.expenses.length === 0 && sources.changeOrders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No eligible unbilled project sources.</p>
      ) : null}
      {[
        ['Expenses', sources.expenses, 'expense'],
        ['Approved change orders', sources.changeOrders, 'changeOrder'],
      ].map(([title, rows, group]) => (
        <div key={title as string}>
          <h3 className="text-sm font-medium mb-2">{title as string}</h3>
          {(rows as BillableSource[]).map((source) => {
            const checked =
              group === 'expense'
                ? selectedExpenses.includes(source.id)
                : selectedChangeOrders.includes(source.id);
            return (
              <label key={source.id} className="flex items-center gap-3 py-2 border-t text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(source.id, group as 'expense' | 'changeOrder')}
                />
                <span className="flex-1">
                  {source.description}
                  {source.expenseDate
                    ? ` · ${new Date(source.expenseDate).toLocaleDateString()}`
                    : ''}
                </span>
                <span className="tabular-nums">{source.amount}</span>
              </label>
            );
          })}
        </div>
      ))}
      {sources.expenses.length + sources.changeOrders.length > 0 ? (
        <label className="flex items-center gap-3 text-sm">
          Tax rate for selected items (%)
          <input
            className="w-24 rounded border px-2 py-1"
            inputMode="decimal"
            value={taxRate}
            onChange={(event) => setTaxRate(event.target.value)}
            aria-label="Tax rate for selected items"
          />
        </label>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      <button
        type="button"
        disabled={!hasSelection || saving}
        onClick={addSelected}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? 'Adding…' : 'Add selected to invoice'}
      </button>
    </section>
  );
}
