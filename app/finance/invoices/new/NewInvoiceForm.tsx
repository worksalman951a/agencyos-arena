'use client';

/**
 * New-invoice form.
 *
 * Interactive markup lives in a Client Component; the page that renders it is a
 * Server Component that has already resolved the selectable clients through the
 * service layer. The client is chosen from a list instead of being typed in as a
 * raw CUID, which previously made the field effectively unusable.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useToast } from '@/components/ui/use-toast';
import { Combobox } from '@/components/ui/combobox';
import { listCurrencies } from '@/lib/currencies';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoInvoiceFormView } from '@/components/finance/bento-invoice-form-view';

const CURRENCY_OPTIONS = listCurrencies().map((option) => ({
  value: option.code,
  label: `${option.code} — ${option.name}`,
  description: option.symbol ? `Symbol ${option.symbol}` : undefined,
}));

interface ContactOption {
  id: string;
  label: string;
}

interface ProjectOption {
  id: string;
  label: string;
}

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

const emptyLineItem = (taxRate = 0): LineItem => ({
  description: '',
  quantity: '1',
  unitPrice: '0',
  taxRate: String(taxRate),
});

export function NewInvoiceForm({
  contacts,
  projects = [],
  defaultProjectId = '',
  defaultClientId = '',
  defaultCurrency = 'USD',
  defaultTaxRate = 0,
}: {
  contacts: ContactOption[];
  /** Projects the invoice may be linked to, resolved (and authorized) server-side. */
  projects?: ProjectOption[];
  /** Preselected project when the form is opened from a project workspace. */
  defaultProjectId?: string;
  /** Preselected client (the project's client on a project handoff). */
  defaultClientId?: string;
  /** Organization default currency (settings) — still editable per invoice. */
  defaultCurrency?: string;
  /** Organization default tax rate (%) applied to new line items. */
  defaultTaxRate?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [clientId, setClientId] = useState(defaultClientId);
  // Only a project the server offered can be preselected; the API validates the
  // id again on submit, so this is a convenience and never an authorization.
  const [projectId, setProjectId] = useState(
    projects.some((project) => project.id === defaultProjectId) ? defaultProjectId : ''
  );
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('draft');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem(defaultTaxRate)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBento = useBentoShell();

  const addLineItem = () => setLineItems([...lineItems, emptyLineItem(defaultTaxRate)]);

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, patch: Partial<LineItem>) => {
    setLineItems(lineItems.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e?.preventDefault) e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/v1/crm/invoices', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId || undefined,
          projectId: projectId || undefined,
          title,
          status,
          currency,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
          lineItems: lineItems.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
          })),
        }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          res.status === 403
            ? 'You do not have permission to create invoices.'
            : (err.error ?? 'Failed to create invoice');
        setError(msg);
        throw new Error(msg);
      }

      const data = (await res.json()) as { id: string };
      toast({ title: 'Invoice created', description: 'Opening the new invoice…' });
      router.push(`/finance/invoices/${data.id}`);
    } catch (err) {
      toast({
        title: 'Could not create invoice',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (isBento) {
    return (
      <BentoInvoiceFormView
        mode="new"
        clientId={clientId}
        setClientId={setClientId}
        contacts={contacts}
        title={title}
        setTitle={setTitle}
        status={status}
        setStatus={setStatus}
        currency={currency}
        setCurrency={setCurrency}
        currencyOptions={CURRENCY_OPTIONS}
        dueDate={dueDate}
        setDueDate={setDueDate}
        notes={notes}
        setNotes={setNotes}
        lineItems={lineItems}
        onAddLineItem={addLineItem}
        onRemoveLineItem={removeLineItem}
        onUpdateLineItem={updateLineItem}
        onSubmit={handleSubmit}
        isLoading={loading}
        error={error}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="clientId" className="text-sm font-medium">
            Client
          </label>
          <select
            id="clientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="">No client</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.label}
              </option>
            ))}
          </select>
          {contacts.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No clients are available to select (none exist yet, or your role cannot read
              contacts). You can still create the invoice and attach a client later.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor="title" className="text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Invoice title"
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="projectId" className="text-sm font-medium">
          Project
        </label>
        <select
          id="projectId"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.label}
            </option>
          ))}
        </select>
        {(() => {
          const selectedProj = projects.find(
            (p) => (p as { id: string; clientId?: string | null }).id === projectId
          ) as { id: string; label: string; clientId?: string | null } | undefined;
          const hasMismatch =
            selectedProj?.clientId && clientId && selectedProj.clientId !== clientId;
          if (hasMismatch) {
            return (
              <p
                className="text-xs text-amber-600 dark:text-amber-400 font-medium"
                data-testid="project-client-mismatch-warning"
              >
                Note: The selected project belongs to a different client than the one selected
                above.
              </p>
            );
          }
          return null;
        })()}
        <p className="text-xs text-muted-foreground">
          {projects.length === 0
            ? 'No projects are available to link (none are open, or your role cannot read projects). The invoice can be created without one.'
            : 'Optional. Linked invoices appear in the project workspace.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="currency" className="text-sm font-medium">
            Currency
          </label>
          <Combobox
            id="currency"
            options={CURRENCY_OPTIONS}
            value={currency}
            onChange={setCurrency}
            placeholder="Select a currency"
            searchPlaceholder="Search currencies…"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="dueDate" className="text-sm font-medium">
            Due date
          </label>
          <input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="notes" className="text-sm font-medium">
          Notes
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full border border-input rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div className="border border-input rounded-md p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Line Items</h3>
          <button
            type="button"
            onClick={addLineItem}
            className="text-xs text-accent hover:underline"
          >
            Add line item
          </button>
        </div>
        {lineItems.map((item, index) => (
          <div key={index} className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3 items-end">
            <input
              type="text"
              aria-label={`Line ${index + 1} description`}
              value={item.description}
              onChange={(e) => updateLineItem(index, { description: e.target.value })}
              placeholder="Description"
              className="border border-input rounded-md px-3 py-2 text-sm"
              required
            />
            <input
              type="text"
              inputMode="decimal"
              aria-label={`Line ${index + 1} quantity`}
              value={item.quantity}
              onChange={(e) => updateLineItem(index, { quantity: e.target.value })}
              placeholder="Qty"
              className="border border-input rounded-md px-3 py-2 text-sm text-right"
              required
            />
            <input
              type="text"
              inputMode="decimal"
              aria-label={`Line ${index + 1} unit price`}
              value={item.unitPrice}
              onChange={(e) => updateLineItem(index, { unitPrice: e.target.value })}
              placeholder="Unit price"
              className="border border-input rounded-md px-3 py-2 text-sm text-right"
              required
            />
            <input
              type="text"
              inputMode="decimal"
              aria-label={`Line ${index + 1} tax rate`}
              value={item.taxRate}
              onChange={(e) => updateLineItem(index, { taxRate: e.target.value })}
              placeholder="Tax %"
              className="border border-input rounded-md px-3 py-2 text-sm text-right"
              required
            />
            {lineItems.length > 1 ? (
              <button
                type="button"
                onClick={() => removeLineItem(index)}
                className="text-xs text-destructive hover:bg-destructive/10 rounded-md p-1"
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {loading ? 'Creating…' : 'Create Invoice'}
        </button>
        <Link
          href="/finance/invoices"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
