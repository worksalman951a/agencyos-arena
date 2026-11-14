'use client';

/**
 * Edit-invoice form (Client Component).
 *
 * Receives the invoice from the Server Component, which has already validated
 * the session, the `invoice.read` permission, the editability of the status and
 * the `invoice.update` permission. Saving therefore never discovers a 403/400
 * for a state the UI could have known about.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useToast } from '@/components/ui/use-toast';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoInvoiceFormView } from '@/components/finance/bento-invoice-form-view';

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

export interface EditableInvoice {
  id: string;
  number: string;
  title: string;
  status: string;
  currency: string;
  dueDate: string | null;
  notes: string | null;
  clientId: string | null;
  projectId?: string | null;
  items: LineItem[];
}

export function EditInvoiceForm({
  invoice,
  contacts,
  projects = [],
  canChangeProject = false,
  statusOptions,
}: {
  invoice: EditableInvoice;
  contacts: ContactOption[];
  /** Linkable projects plus the currently linked one, resolved server-side. */
  projects?: ProjectOption[];
  /**
   * False once payments are recorded: the service refuses to move a paid-against
   * invoice between projects, so the selector is shown read-only and the field
   * is left out of the request.
   */
  canChangeProject?: boolean;
  /** Current status plus the transitions the service will accept. */
  statusOptions: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [clientId, setClientId] = useState(invoice.clientId ?? '');
  const [projectId, setProjectId] = useState(invoice.projectId ?? '');
  const [title, setTitle] = useState(invoice.title);
  const [status, setStatus] = useState(invoice.status);
  const [currency, setCurrency] = useState(invoice.currency);
  const [dueDate, setDueDate] = useState(invoice.dueDate ? invoice.dueDate.slice(0, 10) : '');
  const [notes, setNotes] = useState(invoice.notes ?? '');
  const [lineItems, setLineItems] = useState<LineItem[]>(
    invoice.items.length > 0 ? invoice.items : [{ ...emptyLine() }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBento = useBentoShell();

  function emptyLine(): LineItem {
    return { description: '', quantity: '1', unitPrice: '0', taxRate: '0' };
  }

  const addLineItem = () => setLineItems([...lineItems, emptyLine()]);

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, patch: Partial<LineItem>) => {
    setLineItems(lineItems.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e?.preventDefault) e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/crm/invoices/${invoice.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId || null,
          ...(canChangeProject ? { projectId: projectId || null } : {}),
          title,
          status,
          currency,
          dueDate: dueDate || null,
          notes: notes || null,
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
            ? 'You do not have permission to edit invoices.'
            : (err.error ?? 'Failed to update invoice');
        setError(msg);
        throw new Error(msg);
      }

      toast({ title: 'Invoice updated', description: `Invoice ${invoice.number} saved.` });
      router.push(`/finance/invoices/${invoice.id}`);
    } catch (err) {
      toast({
        title: 'Could not update invoice',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (isBento) {
    return (
      <BentoInvoiceFormView
        mode="edit"
        invoiceId={invoice.id}
        invoiceNumber={invoice.number}
        clientId={clientId}
        setClientId={setClientId}
        contacts={contacts}
        projects={projects}
        projectId={projectId}
        setProjectId={setProjectId}
        projectSelectorDisabled={!canChangeProject}
        projectHint={
          canChangeProject
            ? 'Changing the project is recorded in the audit log.'
            : 'The project cannot be changed once payments have been recorded on this invoice.'
        }
        title={title}
        setTitle={setTitle}
        status={status}
        setStatus={setStatus}
        statusOptions={statusOptions}
        currency={currency}
        setCurrency={setCurrency}
        dueDate={dueDate}
        setDueDate={setDueDate}
        notes={notes}
        setNotes={setNotes}
        lineItems={lineItems}
        onAddLineItem={addLineItem}
        onRemoveLineItem={removeLineItem}
        onUpdateLineItem={updateLineItem}
        onSubmit={handleSubmit}
        isLoading={saving}
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
            required
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
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
          disabled={!canChangeProject}
          className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60"
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
          {canChangeProject
            ? 'Changing the project is recorded in the audit log.'
            : 'The project cannot be changed once payments have been recorded on this invoice.'}
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
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="currency" className="text-sm font-medium">
            Currency
          </label>
          <select
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="PKR">PKR</option>
          </select>
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
          disabled={saving}
          className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <Link
          href={`/finance/invoices/${invoice.id}`}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
