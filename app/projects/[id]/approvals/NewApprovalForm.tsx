'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

interface ContactSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export function NewApprovalForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [contactId, setContactId] = useState('');
  const [status, setStatus] = useState('pending');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [contactQuery, setContactQuery] = useState('');
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setContactsLoading(true);
      const params = new URLSearchParams({ pageSize: '100', sortBy: 'lastName', sortOrder: 'asc' });
      if (contactQuery.trim()) params.set('search', contactQuery.trim());
      fetch(`/api/v1/crm/contacts?${params.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as { contacts?: ContactSummary[] };
          setContacts(Array.isArray(data.contacts) ? data.contacts : []);
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setContactsLoading(false);
        });
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [contactQuery]);

  const contactOptions: ComboboxOption[] = contacts.map((contact) => {
    const label =
      `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.email || 'Unnamed';
    return {
      value: contact.id,
      label,
      description: contact.email ?? undefined,
    };
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch('/api/v1/projects/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          contactId: contactId || null,
          status,
          feedback: feedback.trim() || null,
        }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Failed to record approval');
        return;
      }

      toast.success('Approval recorded');
      setContactId('');
      setStatus('pending');
      setFeedback('');
      router.refresh();
    } catch {
      toast.error('Failed to record approval');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="approval-contact" className="text-sm font-medium">
            Client Contact (optional for internal approvals)
          </label>
          <Combobox
            id="approval-contact"
            options={contactOptions}
            value={contactId}
            onChange={setContactId}
            onSearchChange={setContactQuery}
            placeholder="Internal approval (no client contact)"
            searchPlaceholder="Search contacts…"
            emptyMessage="No contacts found"
            loading={contactsLoading && contacts.length === 0}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="approval-status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="approval-status"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={submitting}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="changes_requested">Changes Requested</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="approval-feedback" className="text-sm font-medium">
          Feedback
        </label>
        <textarea
          id="approval-feedback"
          name="feedback"
          rows={3}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          disabled={submitting}
          placeholder="Client or internal review notes..."
          className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Record Approval'}
      </button>
    </form>
  );
}
