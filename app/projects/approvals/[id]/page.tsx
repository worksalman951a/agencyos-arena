/**
 * AgencyOS Edit Project Approval page.
 * Client component form for editing an existing project approval.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

interface ContactSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export default function EditProjectApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [contactId, setContactId] = useState('');
  const [currentContactLabel, setCurrentContactLabel] = useState<string>('');
  const [status, setStatus] = useState('pending');
  const [initialStatus, setInitialStatus] = useState('pending');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [contactQuery, setContactQuery] = useState('');
  const [contacts, setContacts] = useState<ContactSummary[]>([]);

  useEffect(() => {
    let active = true;
    params.then(async ({ id: pid }) => {
      if (!active) return;
      setId(pid);
      try {
        const res = await fetch(`/api/v1/projects/approvals/${encodeURIComponent(pid)}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || 'Failed to load approval');
        }
        const data = (await res.json()) as {
          projectId: string;
          project?: { name: string } | null;
          contactId: string | null;
          contact?: { firstName: string | null; lastName: string } | null;
          status: string;
          feedback: string | null;
        };
        if (!active) return;
        setProjectId(data.projectId);
        setProjectName(data.project?.name ?? '');
        setContactId(data.contactId || '');
        if (data.contact) {
          setCurrentContactLabel(
            `${data.contact.firstName ?? ''} ${data.contact.lastName ?? ''}`.trim()
          );
        }
        setStatus(data.status || 'pending');
        setInitialStatus(data.status || 'pending');
        setFeedback(data.feedback || '');
        setLoadError(null);
      } catch (err) {
        if (!active) return;
        const message = (err as Error).message;
        setLoadError(message);
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [params]);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ pageSize: '100', sortBy: 'lastName', sortOrder: 'asc' });
      if (contactQuery.trim()) qs.set('search', contactQuery.trim());
      fetch(`/api/v1/crm/contacts?${qs.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as { contacts?: ContactSummary[] };
          setContacts(Array.isArray(data.contacts) ? data.contacts : []);
        })
        .catch(() => {});
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

  if (contactId && currentContactLabel && !contactOptions.some((opt) => opt.value === contactId)) {
    contactOptions.unshift({ value: contactId, label: currentContactLabel });
  }

  const backHref = projectId ? `/projects/${projectId}/approvals` : '/projects/approvals';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projects/approvals/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: contactId || null,
          status,
          feedback: feedback.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to update approval');
      }

      toast.success('Approval updated');
      router.push(backHref);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading approval…</div>;
  }

  if (loadError) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
        <Link href="/projects/approvals" className="text-sm text-accent hover:underline">
          Back to Approvals
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Edit Approval</h1>
          {projectName && <p className="text-sm text-muted-foreground">{projectName}</p>}
        </div>
        <Link
          href={backHref}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="space-y-2">
          <label htmlFor="edit-approval-contact" className="text-sm font-medium">
            Client Contact (optional)
          </label>
          <Combobox
            id="edit-approval-contact"
            options={contactOptions}
            value={contactId}
            onChange={setContactId}
            onSearchChange={setContactQuery}
            placeholder="Internal approval (no client contact)"
            searchPlaceholder="Search contacts…"
            emptyMessage="No contacts found"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="edit-approval-status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="edit-approval-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={initialStatus === 'approved'}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="changes_requested">Changes Requested</option>
            <option value="rejected">Rejected</option>
          </select>
          {initialStatus === 'approved' && (
            <p className="text-xs text-muted-foreground">
              Approved records are finalized and cannot transition to another status.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="edit-approval-feedback" className="text-sm font-medium">
            Feedback
          </label>
          <textarea
            id="edit-approval-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="Client or internal feedback..."
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
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
