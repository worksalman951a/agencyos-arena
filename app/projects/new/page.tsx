/**
 * AgencyOS Project New page.
 *
 * Client component form for creating a new project. The client is chosen from
 * the organization's real contacts (searchable combobox) instead of pasting a
 * raw database id, and the form reports server validation errors inline while
 * still toasting unexpected failures.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

interface FieldErrors {
  [field: string]: string;
}

export default function NewProjectPage() {
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('active');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [contactQuery, setContactQuery] = useState('');
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);

  // Fetching contacts: debounced search, cancellation via AbortController, and
  // an explicit error state so an empty list is never mistaken for "no clients".
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setContactsLoading(true);
      const params = new URLSearchParams({
        pageSize: '100',
        sortBy: 'lastName',
        sortOrder: 'asc',
      });
      if (contactQuery.trim()) params.set('search', contactQuery.trim());

      fetch(`/api/v1/crm/contacts?${params.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(
              res.status === 403
                ? 'You do not have permission to view contacts.'
                : 'Could not load contacts.'
            );
          }
          const data = (await res.json()) as { contacts?: ContactSummary[] };
          setContacts(Array.isArray(data.contacts) ? data.contacts : []);
          setContactsError(null);
        })
        .catch((err: unknown) => {
          if ((err as Error).name === 'AbortError') return;
          setContacts([]);
          setContactsError((err as Error).message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setContactsLoading(false);
        });
    }, 250);

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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setFieldErrors({});
      setFormError(null);

      try {
        const res = await fetch('/api/v1/crm/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientId || undefined,
            name,
            status,
            budget: budget || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            description: description || undefined,
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
            issues?: Array<{ path?: Array<string | number>; message?: string }>;
          };

          const errors: FieldErrors = {};
          for (const issue of err.issues ?? []) {
            const key = (issue.path ?? []).filter(Boolean).join('.');
            if (key && issue.message && !errors[key]) errors[key] = issue.message;
          }
          if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            setFormError('Please correct the highlighted fields.');
          } else {
            setFormError(err.error || `Could not create the project (${res.status}).`);
          }
          return;
        }

        const data = (await res.json()) as { id: string };
        toast.success('Project created');
        router.push(`/projects/${data.id}`);
      } catch (err) {
        setFormError((err as Error).message || 'Could not create the project.');
        toast.error('Could not create the project');
      } finally {
        setLoading(false);
      }
    },
    [budget, clientId, description, endDate, name, router, startDate, status]
  );

  const inputClass = (field: string) =>
    `w-full border rounded-md px-3 py-2 text-sm bg-background ${
      fieldErrors[field] ? 'border-destructive' : 'border-input'
    }`;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">New Project</h1>
        <Link
          href="/projects"
          className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {formError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="project-client">
              Client
            </label>
            <Combobox
              id="project-client"
              options={contactOptions}
              value={clientId}
              onChange={setClientId}
              onSearchChange={setContactQuery}
              placeholder="Internal project (no client)"
              searchPlaceholder="Search clients…"
              emptyMessage={contactsError ?? 'No clients found'}
              loading={contactsLoading && contacts.length === 0}
              aria-describedby="project-client-help"
            />
            <p id="project-client-help" className="text-xs text-muted-foreground">
              Optional. Leave empty for internal projects.
            </p>
            {fieldErrors.clientId && (
              <p className="text-xs text-destructive">{fieldErrors.clientId}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="project-name">
              Project Name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Website Redesign"
              className={inputClass('name')}
              aria-invalid={Boolean(fieldErrors.name)}
              required
            />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="project-status">
              Status
            </label>
            <select
              id="project-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputClass('status')}
            >
              <option value="active">Active</option>
              <option value="on-hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="project-budget">
              Budget
            </label>
            <input
              id="project-budget"
              type="text"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0.00"
              className={`${inputClass('budget')} text-right`}
              aria-invalid={Boolean(fieldErrors.budget)}
            />
            {fieldErrors.budget && <p className="text-xs text-destructive">{fieldErrors.budget}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="project-end-date">
              End date
            </label>
            <input
              id="project-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass('endDate')}
            />
            {fieldErrors.endDate && (
              <p className="text-xs text-destructive">{fieldErrors.endDate}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="project-start-date">
            Start date
          </label>
          <input
            id="project-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass('startDate')}
          />
          {fieldErrors.startDate && (
            <p className="text-xs text-destructive">{fieldErrors.startDate}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="project-description">
            Description
          </label>
          <textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputClass('description')}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-accent px-6 py-3 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? 'Creating…' : 'Create Project'}
        </button>
      </form>
    </div>
  );
}
