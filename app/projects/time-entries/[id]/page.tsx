/**
 * AgencyOS Edit Time Entry page.
 * Allows viewing, updating, and deleting an existing time entry.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoTimeEntryFormView } from '@/components/projects/bento-time-entry-form-view';

interface MemberOption {
  id: string;
  name: string | null;
  email: string;
}

interface ProjectWithTasks {
  id: string;
  name: string;
  tasks: Array<{ id: string; title: string }>;
}

export default function EditTimeEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [id, setId] = useState('');
  const [userId, setUserId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [date, setDate] = useState('');
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(false);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [projects, setProjects] = useState<ProjectWithTasks[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    params.then(async ({ id: entryId }) => {
      if (!active) return;
      setId(entryId);
      try {
        const [entryRes, memRes, projRes] = await Promise.all([
          fetch(`/api/v1/projects/time-entries/${encodeURIComponent(entryId)}`),
          fetch('/api/v1/projects/members'),
          fetch('/api/v1/crm/projects?pageSize=100&sortBy=name&sortOrder=asc'),
        ]);

        if (!entryRes.ok) {
          const err = (await entryRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || 'Failed to load time entry');
        }

        const entry = (await entryRes.json()) as {
          userId: string;
          taskId: string | null;
          date: string;
          hours: string;
          description: string | null;
          billable: boolean;
        };

        if (!active) return;
        setUserId(entry.userId || '');
        setTaskId(entry.taskId || '');
        setDate(entry.date ? new Date(entry.date).toISOString().slice(0, 10) : '');
        setHours(entry.hours || '');
        setDescription(entry.description || '');
        setBillable(Boolean(entry.billable));
        setLoadError(null);

        if (memRes.ok) {
          const memData = (await memRes.json()) as { members?: MemberOption[] };
          if (active && Array.isArray(memData.members)) setMembers(memData.members);
        }
        if (projRes.ok) {
          const projData = (await projRes.json()) as { projects?: ProjectWithTasks[] };
          if (active && Array.isArray(projData.projects)) {
            setProjects(projData.projects);
            if (entry.taskId) {
              const matchedProj = projData.projects.find((p) =>
                p.tasks.some((t) => t.id === entry.taskId)
              );
              if (matchedProj) {
                setProjectId(matchedProj.id);
              }
            }
          }
        }
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

  const allTasks = projects.flatMap((p) =>
    p.tasks.map((t) => ({ id: t.id, label: `${p.name}: ${t.title}` }))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/time-entries/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId || undefined,
          taskId: taskId || null,
          date: `${date}T00:00:00.000Z`,
          hours,
          description: description.trim() || null,
          billable,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to update time entry');
      }
      toast.success('Time entry updated');
      router.push('/projects/time-entries');
      router.refresh();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this time entry?')) return;
    try {
      const res = await fetch(`/api/v1/projects/time-entries/${encodeURIComponent(id)}`, {
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

  const availableTasks = projectId
    ? (projects.find((p) => p.id === projectId)?.tasks ?? [])
    : projects.flatMap((p) => p.tasks.map((t) => ({ id: t.id, title: `${p.name}: ${t.title}` })));

  const tasksForBento = availableTasks.map((t) => ({
    id: t.id,
    title: t.title,
    projectId,
  }));

  if (isBento) {
    return (
      <BentoTimeEntryFormView
        mode="edit"
        entryId={id}
        userId={userId}
        setUserId={setUserId}
        members={members}
        projectId={projectId}
        setProjectId={setProjectId}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        taskId={taskId}
        setTaskId={setTaskId}
        tasks={tasksForBento}
        date={date}
        setDate={setDate}
        hours={hours}
        setHours={setHours}
        billable={billable}
        setBillable={setBillable}
        description={description}
        setDescription={setDescription}
        onSubmit={handleSubmit}
        isLoading={saving}
        error={error}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit Time Entry</h1>
        <div className="flex gap-2">
          <Link
            href="/projects/time-entries"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Time Entries
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90"
          >
            Delete
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="edit-te-user" className="text-sm font-medium">
              Team Member
            </label>
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
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-te-task" className="text-sm font-medium">
              Task (optional)
            </label>
            <select
              id="edit-te-task"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="">General (no task)</option>
              {allTasks.map((t) => (
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
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
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

        <div className="space-y-2">
          <label htmlFor="edit-te-description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="edit-te-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
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
