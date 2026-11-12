'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Plus, Trash2, Shield, AlertTriangle } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { formatDecimalMoney } from '@/lib/finance/decimal-utils';
import Decimal from 'decimal.js';
import '@/components/crm/bento-contacts.css';

interface ContactOption {
  id: string;
  label: string;
}

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

interface CurrencyOption {
  value: string;
  label: string;
  description?: string;
}

interface BentoInvoiceFormViewProps {
  mode: 'new' | 'edit';
  invoiceId?: string;
  invoiceNumber?: string;
  // Form fields
  clientId: string;
  setClientId: (val: string) => void;
  contacts: ContactOption[];
  title: string;
  setTitle: (val: string) => void;
  status: string;
  setStatus: (val: string) => void;
  statusOptions?: Array<{ value: string; label: string }>;
  currency: string;
  setCurrency: (val: string) => void;
  currencyOptions?: CurrencyOption[];
  dueDate: string;
  setDueDate: (val: string) => void;
  notes: string;
  setNotes: (val: string) => void;
  lineItems: LineItem[];
  onAddLineItem: () => void;
  onRemoveLineItem: (index: number) => void;
  onUpdateLineItem: (index: number, patch: Partial<LineItem>) => void;
  // Submission
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error?: string | null;
}

export function BentoInvoiceFormView({
  mode,
  invoiceId,
  invoiceNumber,
  clientId,
  setClientId,
  contacts,
  title,
  setTitle,
  status,
  setStatus,
  statusOptions,
  currency,
  setCurrency,
  currencyOptions,
  dueDate,
  setDueDate,
  notes,
  setNotes,
  lineItems,
  onAddLineItem,
  onRemoveLineItem,
  onUpdateLineItem,
  onSubmit,
  isLoading,
  error,
}: BentoInvoiceFormViewProps) {
  const isEdit = mode === 'edit';

  // Safely compute subtotal, tax, and grand total using Decimal.js
  const totals = React.useMemo(() => {
    let subtotal = new Decimal(0);
    let tax = new Decimal(0);

    for (const item of lineItems) {
      try {
        const qty = new Decimal(item.quantity || 0);
        const price = new Decimal(item.unitPrice || 0);
        const rate = new Decimal(item.taxRate || 0).dividedBy(100);
        const lineSubtotal = qty.times(price);
        const lineTax = lineSubtotal.times(rate);
        subtotal = subtotal.plus(lineSubtotal);
        tax = tax.plus(lineTax);
      } catch {
        // Fallback for non-numeric input during typing
      }
    }

    const total = subtotal.plus(tax);
    return {
      subtotalStr: subtotal.toFixed(2),
      taxStr: tax.toFixed(2),
      totalStr: total.toFixed(2),
    };
  }, [lineItems]);

  const selectedContact = contacts.find((c) => c.id === clientId);

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link
              href={isEdit && invoiceId ? `/finance/invoices/${invoiceId}` : '/finance/invoices'}
              title="Cancel and return"
            >
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/finance/invoices" className="hover:underline">
                Finance
              </Link>
              <span>/</span>
              <Link href="/finance/invoices" className="hover:underline">
                Invoices
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Invoice' : 'New Invoice'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit
                ? `Edit Invoice: ${invoiceNumber || title || 'Invoice'}`
                : 'New Sales Invoice'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              href={isEdit && invoiceId ? `/finance/invoices/${invoiceId}` : '/finance/invoices'}
            >
              Cancel
            </Link>
          </Button>
          <Button onClick={onSubmit} size="sm" disabled={isLoading}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving…' : isEdit ? 'Save Invoice Changes' : 'Create Invoice'}
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary ───────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Document Type',
            value: isEdit ? `Invoice ${invoiceNumber || ''}` : 'Sales Invoice',
            note: isEdit ? 'Updating commercial record' : 'Drafting new invoice',
          },
          {
            label: 'Billing Client',
            value: selectedContact ? selectedContact.label : 'Direct Individual',
            note: clientId ? 'Linked CRM Contact' : 'No account affiliation',
          },
          {
            label: 'Status & Currency',
            value: `${status.toUpperCase()} (${currency})`,
            note: `Due ${dueDate || 'on receipt'}`,
            tone: status === 'paid' ? 'ok' : status === 'sent' ? 'warn' : undefined,
          },
          {
            label: 'Grand Total',
            value: `${currency} ${formatDecimalMoney(totals.totalStr)}`,
            note: `${lineItems.length} line item${lineItems.length === 1 ? '' : 's'} included`,
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
        {/* Main Document & Line Items Panel (2 cols) */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Panel title="Commercial Terms & Invoice Header">
            <form onSubmit={onSubmit} className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium" htmlFor="invoice-title">
                    Invoice Title <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="invoice-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Q4 Platform Retainer & Maintenance"
                    className="h-9 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="invoice-client">
                    Client Contact
                  </label>
                  <select
                    id="invoice-client"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full h-9 border border-input rounded-md px-3 text-xs bg-background"
                  >
                    <option value="">No client selected</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="invoice-status">
                    Lifecycle Status <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="invoice-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full h-9 border border-input rounded-md px-3 text-xs bg-background"
                  >
                    {statusOptions ? (
                      statusOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="draft">Draft</option>
                        <option value="sent">Sent</option>
                        <option value="paid">Paid</option>
                        <option value="void">Void</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="invoice-currency">
                    Billing Currency <span className="text-destructive">*</span>
                  </label>
                  {currencyOptions ? (
                    <Combobox
                      id="invoice-currency"
                      options={currencyOptions}
                      value={currency}
                      onChange={setCurrency}
                      placeholder="Select currency"
                    />
                  ) : (
                    <select
                      id="invoice-currency"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full h-9 border border-input rounded-md px-3 text-xs bg-background"
                    >
                      <option value="USD">USD — US Dollar</option>
                      <option value="EUR">EUR — Euro</option>
                      <option value="GBP">GBP — British Pound</option>
                      <option value="CAD">CAD — Canadian Dollar</option>
                      <option value="AUD">AUD — Australian Dollar</option>
                      <option value="PKR">PKR — Pakistani Rupee</option>
                    </select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="invoice-due-date">
                    Due Date
                  </label>
                  <Input
                    id="invoice-due-date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium" htmlFor="invoice-notes">
                    Commercial Notes & Payment Terms
                  </label>
                  <textarea
                    id="invoice-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Wire instructions, Net 30 payment terms, late payment penalties…"
                    className="w-full border border-input rounded-md p-3 text-xs bg-background"
                  />
                </div>
              </div>
            </form>
          </Panel>

          {/* Line Items Table Editor */}
          <Panel title="Billable Items & Services">
            <div className="p-4 space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3 w-20 text-right">Qty</th>
                      <th className="py-2.5 px-3 w-28 text-right">Unit Price</th>
                      <th className="py-2.5 px-3 w-20 text-right">Tax %</th>
                      <th className="py-2.5 px-3 w-28 text-right">Amount</th>
                      <th className="py-2.5 px-2 w-10 text-center" aria-label="Actions"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {lineItems.map((item, index) => {
                      let lineTotal = '0.00';
                      try {
                        const qty = new Decimal(item.quantity || 0);
                        const price = new Decimal(item.unitPrice || 0);
                        const rate = new Decimal(item.taxRate || 0).dividedBy(100);
                        const gross = qty.times(price).times(new Decimal(1).plus(rate));
                        lineTotal = gross.toFixed(2);
                      } catch {
                        // ignore parsing error
                      }

                      return (
                        <tr key={index} className="hover:bg-muted/20">
                          <td className="py-2 px-3">
                            <Input
                              aria-label={`Line ${index + 1} description`}
                              value={item.description}
                              onChange={(e) =>
                                onUpdateLineItem(index, { description: e.target.value })
                              }
                              placeholder="Service or deliverable description"
                              className="h-8 text-xs"
                              required
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              aria-label={`Line ${index + 1} quantity`}
                              inputMode="decimal"
                              value={item.quantity}
                              onChange={(e) =>
                                onUpdateLineItem(index, { quantity: e.target.value })
                              }
                              className="h-8 text-xs text-right font-mono"
                              required
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              aria-label={`Line ${index + 1} unit price`}
                              inputMode="decimal"
                              value={item.unitPrice}
                              onChange={(e) =>
                                onUpdateLineItem(index, { unitPrice: e.target.value })
                              }
                              className="h-8 text-xs text-right font-mono"
                              required
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              aria-label={`Line ${index + 1} tax rate`}
                              inputMode="decimal"
                              value={item.taxRate}
                              onChange={(e) => onUpdateLineItem(index, { taxRate: e.target.value })}
                              className="h-8 text-xs text-right font-mono"
                              required
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-foreground">
                            {currency} {formatDecimalMoney(lineTotal)}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {lineItems.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => onRemoveLineItem(index)}
                                className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                                title="Remove line item"
                              >
                                <Trash2 size={13} />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onAddLineItem}
                  className="text-xs"
                >
                  <Plus size={13} className="mr-1" /> Add Line Item
                </Button>

                {/* Subtotals Box */}
                <div className="w-64 space-y-1.5 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal:</span>
                    <span className="font-mono text-foreground">
                      {currency} {formatDecimalMoney(totals.subtotalStr)}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax:</span>
                    <span className="font-mono text-foreground">
                      {currency} {formatDecimalMoney(totals.taxStr)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-border font-bold text-sm">
                    <span>Total Amount:</span>
                    <span className="font-mono text-foreground">
                      {currency} {formatDecimalMoney(totals.totalStr)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* Guidance and Accounting Rail (1 col) */}
        <div className="lg:col-span-1 space-y-4">
          <Panel title="Financial Policy & Allocation">
            <div className="p-4 space-y-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-accent" />
                <span>Deterministic Calculation</span>
              </div>
              <p>
                Invoices use exact <strong>Decimal.js</strong> arithmetic. Line taxes and subtotals
                are rounded at document generation to avoid floating-point drift.
              </p>
              <div className="pt-2 border-t border-border space-y-1">
                <div className="text-foreground font-semibold">Document Numbering</div>
                <p>
                  Sequence numbers are allocated atomically from your organization settings upon
                  creation.
                </p>
              </div>
              <div className="pt-2 border-t border-border">
                <StatusPill tone="ok">Tenant Segregated</StatusPill>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
