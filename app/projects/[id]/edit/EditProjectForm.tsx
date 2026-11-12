'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoProjectFormView } from '@/components/projects/bento-project-form-view';

interface ContactSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
}

interface EditProjectFormProps {
  project: {
    id: string;
    name: string;
    status: string;
    budget: string | null;
    startDate: Date | null;
    endDate: Date | null;
    description: string | null;
    clientId: string | null;
    templateId: string | null;
    deletedAt: Date | null;
    client: { id: string; firstName: string | null; lastName: string } | null;
  };
}

interface FieldErrors {
  [field: string]: string;
}

function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function EditProjectForm({ project }: EditProjectFormProps) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [clientId, setClientId] = useState(project.clientId ?? '');
  const [templateId, setTemplateId] = useState(project.templateId ?? '');
  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState(project.status);
  const [budget, setBudget] = useState(project.budget ?? '');
  const [startDate, setStartDate] = useState(toDateInputValue(project.startDate));
  const [endDate, setEndDate] = useState(toDateInputValue(project.endDate));
  const [description, setDescription] = useState(project.description ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [contactQuery, setContactQuery] = useState('');
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/projects/templates')
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as TemplateSummary[];
        if (active && Array.isArray(data)) setTemplates(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setContactsLoading(true);
      const contactParams = new URLSearchParams({
        pageSize: '100',
        sortBy: 'lastName',
        sortOrder: 'asc',
      });
      if (contactQuery.trim()) contactParams.set('search', contactQuery.trim());

      fetch(`/api/v1/crm/contacts?${contactParams.toString()}`, { signal: controller.signal })
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

  if (project.client && !contactOptions.some((opt) => opt.value === project.client?.id)) {
    contactOptions.unshift({
      value: project.client.id,
      label:
        `${project.client.firstName ?? ''} ${project.client.lastName ?? ''}`.trim() || 'Client',
    });
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setFieldErrors({});
      setFormError(null);

      try {
        const res = await fetch(`/api/v1/crm/projects/${encodeURIComponent(project.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientId || null,
            templateId: templateId || null,
            name,
            status,
            budget: budget.trim() ? budget.trim() : null,
            startDate: startDate || null,
            endDate: endDate || null,
            description: description.trim() ? description : null,
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
            setFormError(err.error || `Could not update the project (${res.status}).`);
          }
          return;
        }

        toast.success('Project updated');
        router.push(`/projects/${project.id}`);
        router.refresh();
      } catch (err) {
        setFormError((err as Error).message || 'Could not update the project.');
        toast.error('Could not update the project');
      } finally {
        setSaving(false);
      }
    },
    [
      budget,
      clientId,
      description,
      endDate,
      name,
      project.id,
      router,
      startDate,
      status,
      templateId,
    ]
  );

  const handleDelete = async () => {
    if (!window.confirm('Delete this project? It will be hidden from active project lists.')) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/crm/projects/${encodeURIComponent(project.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to delete project');
      }
      toast.success('Project deleted');
      router.push('/projects');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const inputClass = (field: string) =>
    `w-full border rounded-md px-3 py-2 text-sm bg-background ${
      fieldErrors[field] ? 'border-destructive' : 'border-input'
    }`;

  if (isBento) {
    return (
      <BentoProjectFormView
        mode="edit"
        projectId={project.id}
        name={name}
        setName={setName}
        clientId={clientId}
        setClientId={setClientId}
        contactOptions={contactOptions}
        contactsLoading={contactsLoading}
        contactsError={contactsError}
        onSearchChange={setContactQuery}
        status={status}
        setStatus={setStatus}
        templateId={templateId}
        setTemplateId={setTemplateId}
        templates={templates}
        budget={budget}
        setBudget={setBudget}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        description={description}
        setDescription={setDescription}
        isDeleted={Boolean(project.deletedAt)}
        onDelete={handleDelete}
        isDeleting={deleting}
        onSubmit={handleSubmit}
        isLoading={saving}
        error={formError}
        fieldErrors={fieldErrors}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit Project</h1>
        <div className="flex gap-2">
          <Link
            href={`/projects/${project.id}`}
            className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/80"
          >
            Cancel
          </Link>
          {!project.deletedAt && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete Project'}
            </button>
          )}
        </div>
      </div>

      {project.deletedAt && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          This project was deleted and cannot be edited.
        </div>
      )}

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
            <label className="text-sm font-medium" htmlFor="edit-project-client">
              Client
            </label>
            <Combobox
              id="edit-project-client"
              options={contactOptions}
              value={clientId}
              onChange={setClientId}
              onSearchChange={setContactQuery}
              placeholder="Internal project (no client)"
              searchPlaceholder="Search clients…"
              emptyMessage={contactsError ?? 'No clients found'}
              loading={contactsLoading && contacts.length === 0}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="edit-project-name">
              Project Name
            </label>
            <input
              id="edit-project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass('name')}
              required
              disabled={Boolean(project.deletedAt)}
            />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>
        </div>

        {templates.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="edit-project-template">
              Project Template
            </label>
            <select
              id="edit-project-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className={inputClass('templateId')}
              disabled={Boolean(project.deletedAt)}
            >
              <option value="">No template</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="edit-project-status">
              Status
            </label>
            <select
              id="edit-project-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputClass('status')}
              disabled={Boolean(project.deletedAt)}
            >
              <option value="active">Active</option>
              <option value="on-hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="edit-project-budget">
              Budget
            </label>
            <input
              id="edit-project-budget"
              type="text"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0.00"
              className={`${inputClass('budget')} text-right`}
              disabled={Boolean(project.deletedAt)}
            />
            {fieldErrors.budget && <p className="text-xs text-destructive">{fieldErrors.budget}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="edit-project-end-date">
              End Date
            </label>
            <input
              id="edit-project-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass('endDate')}
              disabled={Boolean(project.deletedAt)}
            />
            {fieldErrors.endDate && (
              <p className="text-xs text-destructive">{fieldErrors.endDate}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="edit-project-start-date">
            Start Date
          </label>
          <input
            id="edit-project-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass('startDate')}
            disabled={Boolean(project.deletedAt)}
          />
          {fieldErrors.startDate && (
            <p className="text-xs text-destructive">{fieldErrors.startDate}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="edit-project-description">
            Description
          </label>
          <textarea
            id="edit-project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={inputClass('description')}
            disabled={Boolean(project.deletedAt)}
          />
        </div>

        <button
          type="submit"
          disabled={saving || Boolean(project.deletedAt)}
          className="rounded-md bg-accent px-6 py-3 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
