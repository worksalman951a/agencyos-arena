/**
 * Client form for viewing, updating, and deleting an existing time entry.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  formatMinorUnitsAsCurrency,
  listCurrencies,
  parseAmountToMinorUnits,
} from '@/lib/currencies';
import {
  computeBillableAmountText,
  isValidHourlyRateText,
  isValidHoursText,
} from '@/lib/projects/time-entry-billing';

interface MemberOption {
  id: string;
  name: string | null;
  email: string;
}

interface ProjectWithTasks {
  id: string;
  name: string;
  status: string;
  deletedAt: string | null;
  tasks: Array<{ id: string; title: string }>;
}

interface LoadedTimeEntry {
  id: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  date: string;
  hours: string;
  description: string | null;
  billable: boolean;
  hourlyRate: string | null;
  currency: string | null;
  billableAmount: string | null;
  user?: { id: string; name: string | null; email: string | null } | null;
  project?: { id: string; name: string; status: string; deleted: boolean } | null;
  task?: { id: string; title: string; projectId: string } | null;
}

interface EditTimeEntryFormProps {
  entryId: string;
  currentUserId: string;
  isAdmin: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  defaultCurrency: string;
}

export function EditTimeEntryForm({
  entryId,
  currentUserId,
  isAdmin,
  canUpdate,
  canDelete,
  defaultCurrency,
}: EditTimeEntryFormProps) {
  const router = useRouter();
  const [entryOwnerId, setEntryOwnerId] = useState('');
  const [entryOwnerLabel, setEntryOwnerLabel] = useState('');
  const [preservedProject, setPreservedProject] = useState<{
    id: string;
    name: string;
    status: string;
    deleted: boolean;
  } | null>(null);
  const [preservedTask, setPreservedTask] = useState<{
    id: string;
    title: string;
    projectId: string;
  } | null>(null);

  const [userId, setUserId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [date, setDate] = useState('');
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(false);
  const [hourlyRate, setHourlyRate] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [projects, setProjects] = useState<ProjectWithTasks[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currencies = useMemo(() => listCurrencies(), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/v1/projects/time-entries/${encodeURIComponent(entryId)}`),
      isAdmin ? fetch('/api/v1/projects/members') : Promise.resolve(null),
      fetch('/api/v1/crm/projects?pageSize=100&sortBy=name&sortOrder=asc'),
    ])
      .then(async ([entryRes, memRes, projRes]) => {
        if (!entryRes.ok) {
          const err = (await entryRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || 'Failed to load time entry');
        }

        const entry = (await entryRes.json()) as LoadedTimeEntry;
        if (!active) return;

        setEntryOwnerId(entry.userId);
        setEntryOwnerLabel(entry.user?.name ?? entry.user?.email ?? entry.userId);
        setPreservedProject(entry.project ?? null);
        setPreservedTask(entry.task ?? null);

        setUserId(entry.userId || '');
        setProjectId(entry.projectId || '');
        setTaskId(entry.taskId || '');
        setDate(entry.date ? new Date(entry.date).toISOString().slice(0, 10) : '');
        setHours(entry.hours || '');
        setDescription(entry.description || '');
        setBillable(Boolean(entry.billable));
        setHourlyRate(entry.hourlyRate || '');
        setCurrency(entry.currency || defaultCurrency);
        setLoadError(null);

        if (memRes && memRes.ok) {
          const memData = (await memRes.json()) as { members?: MemberOption[] };
          if (active && Array.isArray(memData.members)) setMembers(memData.members);
        }
        if (projRes.ok) {
          const projData = (await projRes.json()) as { projects?: ProjectWithTasks[] };
          if (active && Array.isArray(projData.projects)) {
            const eligible = projData.projects.filter(
              (p) => p.status !== 'archived' && !p.deletedAt
            );
            setProjects(eligible);
          }
        }
      })
      .catch((err) => {
        if (!active) return;
        const message = (err as Error).message;
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [defaultCurrency, entryId, isAdmin]);

  const isOwnerOrAdmin = isAdmin || (currentUserId !== '' && entryOwnerId === currentUserId);
  const canSubmitEdit = canUpdate && isOwnerOrAdmin;
  const canSubmitDelete = canDelete && isOwnerOrAdmin;

  const availableTasks = useMemo(() => {
    const tasks = projectId
      ? (projects
          .find((p) => p.id === projectId)
          ?.tasks.map((t) => ({
            id: t.id,
            label: t.title,
          })) ?? [])
      : projects.flatMap((p) => p.tasks.map((t) => ({ id: t.id, label: `${p.name}: ${t.title}` })));

    if (
      preservedTask &&
      taskId === preservedTask.id &&
      !tasks.some((t) => t.id === preservedTask.id)
    ) {
      return [{ id: preservedTask.id, label: preservedTask.title }, ...tasks];
    }
    return tasks;
  }, [preservedTask, projectId, projects, taskId]);

  const previewAmount = useMemo(() => {
    if (!billable || !isValidHoursText(hours) || !isValidHourlyRateText(hourlyRate)) {
      return null;
    }
    const text = computeBillableAmountText(hours, hourlyRate, true);
    if (!text) return null;
    return formatMinorUnitsAsCurrency(parseAmountToMinorUnits(text), currency);
  }, [billable, currency, hourlyRate, hours]);

  const handleProjectChange = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    if (taskId) {
      const stillInProject = projects
        .find((p) => p.id === nextProjectId)
        ?.tasks.some((t) => t.id === taskId);
      if (!stillInProject) {
        setTaskId('');
      }
    }
  };

  const handleTaskChange = (nextTaskId: string) => {
    setTaskId(nextTaskId);
    if (!projectId && nextTaskId) {
      const ownerProject = projects.find((p) => p.tasks.some((t) => t.id === nextTaskId));
      if (ownerProject) {
        setProjectId(ownerProject.id);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitEdit) return;
    setSaving(true);
    try {
      const trimmedRate = hourlyRate.trim();
      const payload: Record<string, unknown> = {
        projectId: projectId || null,
        taskId: taskId || null,
        date: `${date}T00:00:00.000Z`,
        hours,
        description: description.trim() || null,
        billable,
      };
      if (isAdmin && userId) {
        payload.userId = userId;
      }
      if (!billable || !trimmedRate) {
        payload.hourlyRate = null;
        payload.currency = null;
      } else {
        payload.hourlyRate = trimmedRate;
        payload.currency = currency;
      }

      const res = await fetch(`/api/v1/projects/time-entries/${encodeURIComponent(entryId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to update time entry');
      }
      toast.success('Time entry updated');
      router.push('/projects/time-entries');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canSubmitDelete) return;
    if (!window.confirm('Delete this time entry?')) return;
    try {
      const res = await fetch(`/api/v1/projects/time-entries/${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to delete time entry');
      }
      toast.success('Time entry deleted');
      router.push('/projects/time-entries');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading time entry…</div>;
  }

  if (loadError) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
        <Link href="/projects/time-entries" className="text-sm text-accent hover:underline">
          Back to Time Entries
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">{canSubmitEdit ? 'Edit Time Entry' : 'Time Entry'}</h1>
        <div className="flex gap-2">
          <Link
            href="/projects/time-entries"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Time Entries
          </Link>
          {canSubmitDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {!isOwnerOrAdmin && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 max-w-2xl">
          Read-only view: only the entry owner or an administrator can edit or delete this time
          entry.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label htmlFor="edit-te-user" className="text-sm font-medium">
              Team Member
            </label>
            {isAdmin && canSubmitEdit ? (
              <select
                id="edit-te-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                required
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ? `${m.name} (${m.email})` : m.email}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="edit-te-user"
                type="text"
                value={entryOwnerLabel}
                disabled
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-muted text-muted-foreground"
              />
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-te-project" className="text-sm font-medium">
              Project
            </label>
            <select
              id="edit-te-project"
              value={projectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={!canSubmitEdit}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60"
            >
              <option value="">No project (general)</option>
              {preservedProject && !projects.some((p) => p.id === preservedProject.id) && (
                <option value={preservedProject.id}>
                  {preservedProject.name}
                  {preservedProject.deleted
                    ? ' (deleted)'
                    : preservedProject.status === 'archived'
                      ? ' (archived)'
                      : ''}
                </option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-te-task" className="text-sm font-medium">
              Task (optional)
            </label>
            <select
              id="edit-te-task"
              value={taskId}
              onChange={(e) => handleTaskChange(e.target.value)}
              disabled={!canSubmitEdit}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60"
            >
              <option value="">General (no task)</option>
              {availableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-2">
            <label htmlFor="edit-te-date" className="text-sm font-medium">
              Date
            </label>
            <input
              id="edit-te-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!canSubmitEdit}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-te-hours" className="text-sm font-medium">
              Hours
            </label>
            <input
              id="edit-te-hours"
              type="text"
              inputMode="decimal"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              disabled={!canSubmitEdit}
              className="w-full border border-input rounded-md px-3 py-2 text-sm text-right bg-background disabled:opacity-60"
              required
            />
          </div>
          <div className="py-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <input
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
                disabled={!canSubmitEdit}
                className="rounded border-input text-accent bg-background"
              />
              Billable hours
            </label>
          </div>
        </div>

        {billable && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end rounded-md border p-4 bg-muted/20">
            <div className="space-y-2">
              <label htmlFor="edit-te-rate" className="text-sm font-medium">
                Hourly Rate (optional)
              </label>
              <input
                id="edit-te-rate"
                type="text"
                inputMode="decimal"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                disabled={!canSubmitEdit}
                placeholder="150.00"
                className="w-full border border-input rounded-md px-3 py-2 text-sm text-right bg-background disabled:opacity-60"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-te-currency" className="text-sm font-medium">
                Currency
              </label>
              <select
                id="edit-te-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={!canSubmitEdit}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="py-2 text-sm">
              <div className="text-xs text-muted-foreground uppercase">Billable Value</div>
              <div className="font-semibold text-green-700">
                {previewAmount ? `${previewAmount} ${currency}` : '—'}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="edit-te-description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="edit-te-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canSubmitEdit}
            rows={3}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60"
          />
        </div>

        {canSubmitEdit && (
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </form>
    </div>
  );
}
