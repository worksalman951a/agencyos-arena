/**
 * AgencyOS Log Time page.
 * Client component form for creating a new time entry using real team member
 * and project/task selectors.
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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

function LogTimeFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isBento = useBentoShell();
  const initialProjectId = searchParams.get('projectId') ?? '';

  const [userId, setUserId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const [taskId, setTaskId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [projects, setProjects] = useState<ProjectWithTasks[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/v1/projects/members').then((r) => (r.ok ? r.json() : null)),
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
          setProjects(projData.projects);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const availableTasks = selectedProjectId
    ? (projects.find((p) => p.id === selectedProjectId)?.tasks ?? [])
    : projects.flatMap((p) => p.tasks.map((t) => ({ id: t.id, title: `${p.name}: ${t.title}` })));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/projects/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId || undefined,
          taskId: taskId || null,
          date: `${date}T00:00:00.000Z`,
          hours,
          description: description || undefined,
          billable,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to log time entry');
      }

      const data = (await res.json()) as { id: string };
      toast.success('Time entry logged');
      router.push(`/projects/time-entries/${data.id}`);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const tasksForBento = availableTasks.map((t) => ({
    id: t.id,
    title: t.title,
    projectId: selectedProjectId,
  }));

  if (isBento) {
    return (
      <BentoTimeEntryFormView
        mode="new"
        userId={userId}
        setUserId={setUserId}
        members={members}
        projectId={selectedProjectId}
        setProjectId={setSelectedProjectId}
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
        isLoading={loading}
        error={error}
      />
    );
  }

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

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label htmlFor="te-user" className="text-sm font-medium">
              Team Member
            </label>
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
          </div>
          <div className="space-y-2">
            <label htmlFor="te-project" className="text-sm font-medium">
              Project Filter
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
              <option value="">All projects</option>
              {selectedProjectId && !projects.some((p) => p.id === selectedProjectId) && (
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
              onChange={(e) => setTaskId(e.target.value)}
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

export default function LogTimePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading form…</div>}>
      <LogTimeFormInner />
    </Suspense>
  );
}
