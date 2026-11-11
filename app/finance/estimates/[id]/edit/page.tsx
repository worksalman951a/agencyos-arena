/**
 * AgencyOS Edit Estimate page.
 * Client component form for editing an existing draft or sent estimate.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface ContactOption {
  id: string;
  firstName: string | null;
  lastName: string;
  email: string | null;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'PKR', 'INR', 'AED', 'SGD', 'JPY'];

export default function EditEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string>('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState('');
  const [number, setNumber] = useState('');
  const [status, setStatus] = useState('draft');
  const [savedStatus, setSavedStatus] = useState('draft');
  const [total, setTotal] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    params.then(async ({ id: pid }) => {
      if (!active) return;
      setId(pid);
      try {
        const [estRes, contactsRes] = await Promise.all([
          fetch(`/api/v1/finance/estimates/${pid}`),
          fetch('/api/v1/crm/contacts?pageSize=100').catch(() => null),
        ]);
        if (!estRes.ok) throw new Error('Failed to load estimate');
        const data = await estRes.json();
        if (!active) return;

        if (contactsRes?.ok) {
          const cData = (await contactsRes.json()) as { contacts?: ContactOption[] };
          if (Array.isArray(cData.contacts)) {
            setContacts(cData.contacts);
          }
        }

        setClientId(data.clientId || '');
        setNumber(data.number || '');
        setStatus(data.status || 'draft');
        setSavedStatus(data.status || 'draft');
        setTotal(data.total || '');
        setCurrency(data.currency || 'USD');
        setValidUntil(data.validUntil ? new Date(data.validUntil).toISOString().split('T')[0] : '');
        setNotes(data.notes || '');
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [params]);

  const isLocked = !['draft', 'sent'].includes(savedStatus);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/finance/estimates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId || undefined,
          number: number.trim() || undefined,
          status,
          total: total.trim() || undefined,
          currency: currency || undefined,
          validUntil: validUntil || null,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to update estimate');
      }

      toast.success('Estimate updated');
      router.push(`/finance/estimates/${id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading estimate…</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit Estimate</h1>
        <Link
          href={id ? `/finance/estimates/${id}` : '/finance/estimates'}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      {isLocked ? (
        <div className="rounded-lg border bg-amber-50 p-6 max-w-2xl space-y-4">
          <h2 className="text-base font-semibold text-amber-900">Estimate is {savedStatus}</h2>
          <p className="text-sm text-amber-800">
            Estimates in <strong>{savedStatus}</strong> status are locked to preserve historical
            financial records.
          </p>
          <div className="flex gap-3">
            {savedStatus === 'accepted' && (
              <Link
                href={`/finance/estimates/${id}/convert`}
                className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
              >
                Convert to Invoice
              </Link>
            )}
            <Link
              href={`/finance/estimates/${id}`}
              className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              Back to Estimate
            </Link>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-6 max-w-2xl bg-card p-6 rounded-lg border border-border"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="edit-estimate-client" className="block text-sm font-medium">
                Client Contact
              </label>
              {contacts.length > 0 ? (
                <select
                  id="edit-estimate-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                  required
                >
                  {!contacts.some((c) => c.id === clientId) && clientId && (
                    <option value={clientId}>{clientId}</option>
                  )}
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
                <input
                  id="edit-estimate-client"
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm"
                  required
                />
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-estimate-number" className="block text-sm font-medium">
                Estimate Number
              </label>
              <input
                id="edit-estimate-number"
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label htmlFor="edit-estimate-status" className="block text-sm font-medium">
                Status
              </label>
              <select
                id="edit-estimate-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                {savedStatus === 'draft' && <option value="draft">Draft</option>}
                <option value="sent">Sent</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-estimate-total" className="block text-sm font-medium">
                Total
              </label>
              <input
                id="edit-estimate-total"
                type="number"
                step="0.01"
                min="0"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm text-right"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-estimate-currency" className="block text-sm font-medium">
                Currency
              </label>
              <select
                id="edit-estimate-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map(
                  (c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-estimate-valid-until" className="block text-sm font-medium">
              Valid Until
            </label>
            <input
              id="edit-estimate-valid-until"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-estimate-notes" className="block text-sm font-medium">
              Notes
            </label>
            <textarea
              id="edit-estimate-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      )}
    </div>
  );
}
