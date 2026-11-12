/**
 * AgencyOS New Estimate page.
 * Client component form for creating a new estimate with real CRM Contact selection
 * and optional pre-population from a Proposal, Quotation, or Contact.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoEstimateFormView } from '@/components/finance/bento-estimate-form-view';

interface ContactOption {
  id: string;
  firstName: string | null;
  lastName: string;
  email: string | null;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'PKR', 'INR', 'AED', 'SGD', 'JPY'];

function suggestEstimateNumber(): string {
  const year = new Date().getFullYear();
  const suffix = String(Math.floor(1000 + Math.random() * 9000));
  return `EST-${year}-${suffix}`;
}

export default function NewEstimatePage() {
  const isBento = useBentoShell();
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [clientId, setClientId] = useState('');
  const [number, setNumber] = useState(suggestEstimateNumber);
  const [status, setStatus] = useState('draft');
  const [total, setTotal] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function init() {
      const search = new URLSearchParams(window.location.search);
      const qClientId = search.get('clientId');
      const fromProposalId = search.get('fromProposalId');
      const fromQuotationId = search.get('fromQuotationId');

      try {
        const [contactsRes, orgRes] = await Promise.all([
          fetch('/api/v1/crm/contacts?pageSize=100').catch(() => null),
          fetch('/api/v1/settings/organization').catch(() => null),
        ]);

        if (!active) return;

        if (contactsRes?.ok) {
          const data = (await contactsRes.json()) as { contacts?: ContactOption[] };
          if (Array.isArray(data.contacts)) {
            setContacts(data.contacts);
          }
        }

        if (orgRes?.ok) {
          const orgData = (await orgRes.json()) as {
            settings?: { defaultCurrency?: string };
          };
          if (orgData.settings?.defaultCurrency) {
            setCurrency(orgData.settings.defaultCurrency);
          }
        }

        if (qClientId) {
          setClientId(qClientId);
        }

        if (fromProposalId) {
          const propRes = await fetch(`/api/v1/crm/proposals/${fromProposalId}`).catch(() => null);
          if (active && propRes?.ok) {
            const prop = await propRes.json();
            if (prop.contactId) setClientId(prop.contactId);
            if (prop.total) setTotal(String(prop.total));
            if (prop.currency) setCurrency(prop.currency);
            if (prop.validUntil) setValidUntil(String(prop.validUntil).slice(0, 10));
            const summary = `Derived from Proposal #${prop.number}: ${prop.title}`;
            setNotes(prop.notes ? `${summary}\n\n${prop.notes}` : summary);
          }
        } else if (fromQuotationId) {
          const quotRes = await fetch(`/api/v1/crm/quotations/${fromQuotationId}`).catch(
            () => null
          );
          if (active && quotRes?.ok) {
            const quot = await quotRes.json();
            if (quot.contactId) setClientId(quot.contactId);
            if (quot.total) setTotal(String(quot.total));
            if (quot.currency) setCurrency(quot.currency);
            if (quot.validUntil) setValidUntil(String(quot.validUntil).slice(0, 10));
            const summary = `Derived from Quotation #${quot.number}: ${quot.title}`;
            setNotes(quot.notes ? `${summary}\n\n${quot.notes}` : summary);
          }
        }
      } finally {
        if (active) setLoadingInit(false);
      }
    }

    void init();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e?.preventDefault) e.preventDefault();
    setError(null);
    if (!clientId) {
      const msg = 'Please select a client contact';
      setError(msg);
      toast.error(msg);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/finance/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          number: number.trim(),
          status,
          total: total.trim(),
          currency: currency.trim() || 'USD',
          validUntil: validUntil || undefined,
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err as { error?: string }).error || 'Failed to create estimate';
        setError(msg);
        throw new Error(msg);
      }

      const data = await res.json();
      toast.success('Estimate created');
      router.push(`/finance/estimates/${data.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (isBento) {
    return (
      <BentoEstimateFormView
        mode="new"
        clientId={clientId}
        setClientId={setClientId}
        contacts={contacts}
        loadingInit={loadingInit}
        number={number}
        setNumber={setNumber}
        status={status}
        setStatus={setStatus}
        total={total}
        setTotal={setTotal}
        currency={currency}
        setCurrency={setCurrency}
        validUntil={validUntil}
        setValidUntil={setValidUntil}
        notes={notes}
        setNotes={setNotes}
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
        <h1 className="text-2xl font-bold">New Estimate</h1>
        <Link
          href="/finance/estimates"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 max-w-2xl bg-card p-6 rounded-lg border border-border"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="estimate-client" className="block text-sm font-medium">
              Client Contact <span className="text-destructive">*</span>
            </label>
            {contacts.length > 0 ? (
              <select
                id="estimate-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={loadingInit}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                required
              >
                <option value="">Select a client contact…</option>
                {contacts.map((c) => {
                  const fullName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unnamed';
                  return (
                    <option key={c.id} value={c.id}>
                      {c.email ? `${fullName} (${c.email})` : fullName}
                    </option>
                  );
                })}
              </select>
            ) : (
              <div className="space-y-1">
                <input
                  id="estimate-client"
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Client contact ID"
                  className="w-full border border-input rounded-md px-3 py-2 text-sm"
                  required
                />
                {!loadingInit && (
                  <p className="text-xs text-muted-foreground">
                    No contacts found yet —{' '}
                    <Link href="/crm/contacts/new" className="text-accent hover:underline">
                      create a contact first
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="estimate-number" className="block text-sm font-medium">
              Estimate Number <span className="text-destructive">*</span>
            </label>
            <input
              id="estimate-number"
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="e.g. EST-2026-0001"
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label htmlFor="estimate-status" className="block text-sm font-medium">
              Status
            </label>
            <select
              id="estimate-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="estimate-total" className="block text-sm font-medium">
              Total <span className="text-destructive">*</span>
            </label>
            <input
              id="estimate-total"
              type="number"
              step="0.01"
              min="0"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="0.00"
              className="w-full border border-input rounded-md px-3 py-2 text-sm text-right"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="estimate-currency" className="block text-sm font-medium">
              Currency
            </label>
            <select
              id="estimate-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            >
              {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="estimate-valid-until" className="block text-sm font-medium">
              Valid Until
            </label>
            <input
              id="estimate-valid-until"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="estimate-notes" className="block text-sm font-medium">
            Notes
          </label>
          <textarea
            id="estimate-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Terms, conditions, or scope summary..."
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {loading ? 'Creating...' : 'Create Estimate'}
        </button>
      </form>
    </div>
  );
}
