/**
 * Client form for logging a new time entry with project, task, and optional
 * hourly billing rate/currency.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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

interface NewTimeEntryFormProps {
  defaultCurrency: string;
  isAdmin: boolean;
}

export function NewTimeEntryForm({ defaultCurrency, isAdmin }: NewTimeEntryFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get('projectId') ?? '';

  const [userId, setUserId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const [taskId, setTaskId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);
  const [hourlyRate, setHourlyRate] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [projects, setProjects] = useState<ProjectWithTasks[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectUnavailableNotice, setProjectUnavailableNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const currencies = useMemo(() => listCurrencies(), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      isAdmin
        ? fetch('/api/v1/projects/members').then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
      fetch('/api/v1/crm/projects?pageSize=100&sortBy=name&sortOrder=asc').then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(([memData, projData]) => {
        if (!active) return;
        if (memData && Array.isArray(memData.members)) {
          setMembers(memData.members);
        }
        if (projData && Array.isArray(projData.projects)) {
          const allProjects = projData.projects as ProjectWithTasks[];
          const eligible = allProjects.filter((p) => p.status !== 'archived' && !p.deletedAt);
          setProjects(eligible);
          setProjectsLoaded(true);

          if (initialProjectId) {
            const matched = allProjects.find((p) => p.id === initialProjectId);
            if (!matched || matched.status === 'archived' || matched.deletedAt) {
              setSelectedProjectId('');
              setProjectUnavailableNotice(
                matched?.status === 'archived'
                  ? `Project "${matched.name}" is archived and cannot accept new time entries.`
                  : 'The preselected project is unavailable for new time entries.'
              );
            }
          }
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [initialProjectId, isAdmin]);

  const availableTasks = selectedProjectId
    ? (projects.find((p) => p.id === selectedProjectId)?.tasks ?? [])
    : projects.flatMap((p) => p.tasks.map((t) => ({ id: t.id, title: `${p.name}: ${t.title}` })));

  const previewAmount = useMemo(() => {
    if (!billable || !isValidHoursText(hours) || !isValidHourlyRateText(hourlyRate)) {
      return null;
    }
    const text = computeBillableAmountText(hours, hourlyRate, true);
    if (!text) return null;
    return formatMinorUnitsAsCurrency(parseAmountToMinorUnits(text), currency);
  }, [billable, currency, hourlyRate, hours]);

  const handleTaskChange = (nextTaskId: string) => {
    setTaskId(nextTaskId);
    if (!selectedProjectId && nextTaskId) {
      const ownerProject = projects.find((p) => p.tasks.some((t) => t.id === nextTaskId));
      if (ownerProject) {
        setSelectedProjectId(ownerProject.id);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const trimmedRate = hourlyRate.trim();
      const payload: Record<string, unknown> = {
        projectId: selectedProjectId || null,
        taskId: taskId || null,
        date: `${date}T00:00:00.000Z`,
        hours,
        description: description || undefined,
        billable,
      };
      if (isAdmin && userId) {
        payload.userId = userId;
      }
      if (billable && trimmedRate) {
        payload.hourlyRate = trimmedRate;
        payload.currency = currency;
      }

      const res = await fetch('/api/v1/projects/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to log time entry');
      }

      const data = (await res.json()) as { id: string };
      toast.success('Time entry logged');
      router.push(`/projects/time-entries/${data.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Log Time Entry</h1>
        <Link
          href={
            initialProjectId
              ? `/projects/time-entries?projectId=${encodeURIComponent(initialProjectId)}`
              : '/projects/time-entries'
          }
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      {projectUnavailableNotice && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 max-w-2xl">
          {projectUnavailableNotice}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label htmlFor="te-user" className="text-sm font-medium">
              Team Member
            </label>
            {isAdmin ? (
              <select
                id="te-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="">Current user (me)</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ? `${m.name} (${m.email})` : m.email}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="te-user"
                type="text"
                value="Current user (me)"
                disabled
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-muted text-muted-foreground"
              />
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="te-project" className="text-sm font-medium">
              Project
            </label>
            <select
              id="te-project"
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setTaskId('');
              }}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="">No project (general)</option>
              {!projectsLoaded && selectedProjectId && (
                <option value={selectedProjectId}>Selected project</option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="te-task" className="text-sm font-medium">
              Task (optional)
            </label>
            <select
              id="te-task"
              value={taskId}
              onChange={(e) => handleTaskChange(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="">General (no task)</option>
              {availableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-2">
            <label htmlFor="te-date" className="text-sm font-medium">
              Date
            </label>
            <input
              id="te-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="te-hours" className="text-sm font-medium">
              Hours
            </label>
            <input
              id="te-hours"
              type="text"
              inputMode="decimal"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="1.5"
              className="w-full border border-input rounded-md px-3 py-2 text-sm text-right bg-background"
              required
            />
          </div>
          <div className="py-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <input
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
                className="rounded border-input text-accent bg-background"
              />
              Billable hours
            </label>
          </div>
        </div>

        {billable && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end rounded-md border p-4 bg-muted/20">
            <div className="space-y-2">
              <label htmlFor="te-rate" className="text-sm font-medium">
                Hourly Rate (optional)
              </label>
              <input
                id="te-rate"
                type="text"
                inputMode="decimal"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="150.00"
                className="w-full border border-input rounded-md px-3 py-2 text-sm text-right bg-background"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="te-currency" className="text-sm font-medium">
                Currency
              </label>
              <select
                id="te-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="py-2 text-sm">
              <div className="text-xs text-muted-foreground uppercase">Estimated Billable</div>
              <div className="font-semibold text-green-700">
                {previewAmount ? `${previewAmount} ${currency}` : '—'}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="te-description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="te-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What did you work on?"
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {loading ? 'Logging...' : 'Log Time Entry'}
        </button>
      </form>
    </div>
  );
}
