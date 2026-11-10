'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface ProjectTaskItem {
  id: string;
  projectId: string;
  assigneeId: string | null;
  milestoneId: string | null;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  estimatedHours: string | null;
  assignee?: { id: string; name: string | null; email: string | null } | null;
  milestone?: { id: string; name: string; status: string } | null;
}

interface ProjectMilestoneItem {
  id: string;
  projectId: string;
  name: string;
  dueDate: Date | null;
  status: string;
  totalTasks: number;
  completedTasks: number;
}

interface ProjectMember {
  id: string;
  name: string | null;
  email: string;
}

export function ProjectActionsBar({
  projectId,
  status,
  isDeleted,
}: {
  projectId: string;
  status: string;
  isDeleted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleToggleArchive = async () => {
    const nextStatus = status === 'archived' ? 'active' : 'archived';
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/crm/projects/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to update project status');
      }
      toast.success(nextStatus === 'archived' ? 'Project archived' : 'Project reactivated');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this project? It will be hidden from active project lists.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/crm/projects/${encodeURIComponent(projectId)}`, {
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
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href="/projects"
        className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
      >
        Back to Projects
      </Link>
      {!isDeleted && (
        <>
          <Link
            href={`/projects/${projectId}/edit`}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            Edit Project
          </Link>
          <button
            type="button"
            onClick={handleToggleArchive}
            disabled={busy}
            className="px-4 py-2 bg-muted text-foreground rounded-md text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
          >
            {status === 'archived' ? 'Restore Active' : 'Archive'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90 disabled:opacity-50"
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}

export function ProjectMilestonesSection({
  projectId,
  milestones,
  isDeleted,
}: {
  projectId: string;
  milestones: ProjectMilestoneItem[];
  isDeleted: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState('pending');
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/projects/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: name.trim(),
          dueDate: dueDate || undefined,
          status,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to add milestone');
      }
      setName('');
      setDueDate('');
      setStatus('pending');
      toast.success('Milestone added');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (milestoneId: string, nextStatus: string) => {
    setUpdatingId(milestoneId);
    try {
      const res = await fetch(`/api/v1/projects/milestones/${encodeURIComponent(milestoneId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to update milestone');
      }
      toast.success('Milestone updated');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (milestoneId: string) => {
    if (!window.confirm('Delete this milestone? Tasks linked to it will remain on the project.')) {
      return;
    }
    setUpdatingId(milestoneId);
    try {
      const res = await fetch(`/api/v1/projects/milestones/${encodeURIComponent(milestoneId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to delete milestone');
      }
      toast.success('Milestone deleted');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="rounded-md border bg-background p-4 space-y-4">
      <h2 className="text-lg font-semibold">Milestones ({milestones.length})</h2>

      {!isDeleted && (
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Milestone name"
            className="sm:col-span-2 border border-input rounded-md px-3 py-2 text-sm bg-background"
            aria-label="Milestone name"
            required
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background"
            aria-label="Milestone due date"
          />
          <div className="flex gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="flex-1 border border-input rounded-md px-2 py-2 text-sm bg-background"
              aria-label="Milestone status"
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No milestones yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-sm text-muted-foreground">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Linked Tasks</th>
                <th className="pb-2 font-medium">Due Date</th>
                <th className="pb-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => (
                <tr key={m.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-3 font-medium text-sm">{m.name}</td>
                  <td className="py-3">
                    {isDeleted ? (
                      <span className="text-xs">{m.status}</span>
                    ) : (
                      <select
                        value={m.status}
                        onChange={(e) => handleStatusChange(m.id, e.target.value)}
                        disabled={updatingId === m.id}
                        aria-label={`Status for ${m.name}`}
                        className="border border-input rounded px-2 py-1 text-xs bg-background"
                      >
                        <option value="pending">pending</option>
                        <option value="in_progress">in_progress</option>
                        <option value="completed">completed</option>
                      </select>
                    )}
                  </td>
                  <td className="py-3 text-sm text-muted-foreground">
                    {m.completedTasks}/{m.totalTasks} done
                  </td>
                  <td className="py-3 text-sm text-muted-foreground">
                    {m.dueDate ? new Date(m.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-3 text-right">
                    {!isDeleted && (
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        disabled={updatingId === m.id}
                        className="text-xs text-destructive hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ProjectTasksSection({
  projectId,
  tasks,
  milestones,
  members,
  isDeleted,
}: {
  projectId: string;
  tasks: ProjectTaskItem[];
  milestones: ProjectMilestoneItem[];
  members: ProjectMember[];
  isDeleted: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [status, setStatus] = useState('todo');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAssigneeId, setEditAssigneeId] = useState('');
  const [editMilestoneId, setEditMilestoneId] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editDueDate, setEditDueDate] = useState('');
  const [editEstimatedHours, setEditEstimatedHours] = useState('');

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/crm/projects/${encodeURIComponent(projectId)}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          status,
          priority,
          assigneeId: assigneeId || null,
          milestoneId: milestoneId || null,
          dueDate: dueDate || null,
          estimatedHours: estimatedHours.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to add task');
      }
      setTitle('');
      setAssigneeId('');
      setMilestoneId('');
      setStatus('todo');
      setPriority('medium');
      setDueDate('');
      setEstimatedHours('');
      toast.success('Task added');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTaskUpdate = async (taskId: string, payload: Record<string, unknown>) => {
    setBusyTaskId(taskId);
    try {
      const res = await fetch(`/api/v1/projects/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to update task');
      }
      toast.success('Task updated');
      setEditingTaskId(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyTaskId(null);
    }
  };

  const startEditing = (task: ProjectTaskItem) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditAssigneeId(task.assigneeId ?? '');
    setEditMilestoneId(task.milestoneId ?? '');
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '');
    setEditEstimatedHours(task.estimatedHours ?? '');
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('Delete this task?')) return;
    setBusyTaskId(taskId);
    try {
      const res = await fetch(`/api/v1/projects/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to delete task');
      }
      toast.success('Task deleted');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <div className="rounded-md border bg-background p-4 space-y-4">
      <h2 className="text-lg font-semibold">Tasks ({tasks.length})</h2>

      {!isDeleted && (
        <form
          onSubmit={handleAddTask}
          className="rounded-md border border-border p-3 space-y-3 bg-muted/20"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New task title"
              className="sm:col-span-2 border border-input rounded-md px-3 py-2 text-sm bg-background"
              aria-label="New task title"
              required
            />
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="border border-input rounded-md px-3 py-2 text-sm bg-background"
              aria-label="Task assignee"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ? `${m.name} (${m.email})` : m.email}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <select
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
              className="border border-input rounded-md px-2 py-2 text-sm bg-background"
              aria-label="Task milestone"
            >
              <option value="">No milestone</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border border-input rounded-md px-2 py-2 text-sm bg-background"
              aria-label="Task status"
            >
              <option value="todo">todo</option>
              <option value="in-progress">in-progress</option>
              <option value="review">review</option>
              <option value="done">done</option>
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="border border-input rounded-md px-2 py-2 text-sm bg-background"
              aria-label="Task priority"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="border border-input rounded-md px-2 py-2 text-sm bg-background"
              aria-label="Task due date"
            />
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                placeholder="Est. hrs"
                className="w-20 border border-input rounded-md px-2 py-2 text-sm bg-background text-right"
                aria-label="Estimated hours"
              />
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-3 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
              >
                {submitting ? 'Adding…' : 'Add Task'}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Title</th>
              <th className="pb-3 font-medium">Assignee</th>
              <th className="pb-3 font-medium">Milestone</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Priority</th>
              <th className="pb-3 font-medium">Due Date</th>
              <th className="pb-3 font-medium text-right">Est. Hrs</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  No tasks yet.
                </td>
              </tr>
            ) : (
              tasks.map((task) => (
                <tr key={task.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-3 text-sm font-medium">
                    {editingTaskId === task.id ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full border border-input rounded px-2 py-1 text-sm bg-background"
                          aria-label="Edit task title"
                        />
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={editAssigneeId}
                            onChange={(e) => setEditAssigneeId(e.target.value)}
                            className="border border-input rounded px-2 py-1 text-xs bg-background"
                            aria-label="Edit task assignee"
                          >
                            <option value="">Unassigned</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name || m.email}
                              </option>
                            ))}
                          </select>
                          <select
                            value={editMilestoneId}
                            onChange={(e) => setEditMilestoneId(e.target.value)}
                            className="border border-input rounded px-2 py-1 text-xs bg-background"
                            aria-label="Edit task milestone"
                          >
                            <option value="">No milestone</option>
                            {milestones.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={editPriority}
                            onChange={(e) => setEditPriority(e.target.value)}
                            className="border border-input rounded px-2 py-1 text-xs bg-background"
                            aria-label="Edit task priority"
                          >
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                            <option value="urgent">urgent</option>
                          </select>
                          <input
                            type="date"
                            value={editDueDate}
                            onChange={(e) => setEditDueDate(e.target.value)}
                            className="border border-input rounded px-2 py-1 text-xs bg-background"
                            aria-label="Edit task due date"
                          />
                          <input
                            type="text"
                            value={editEstimatedHours}
                            onChange={(e) => setEditEstimatedHours(e.target.value)}
                            placeholder="Hrs"
                            className="w-16 border border-input rounded px-2 py-1 text-xs bg-background text-right"
                            aria-label="Edit task estimated hours"
                          />
                        </div>
                      </div>
                    ) : (
                      task.title
                    )}
                  </td>
                  <td className="py-3 text-sm text-muted-foreground">
                    {task.assignee?.name ?? task.assignee?.email ?? 'Unassigned'}
                  </td>
                  <td className="py-3 text-sm text-muted-foreground">
                    {task.milestone?.name ?? '—'}
                  </td>
                  <td className="py-3">
                    {isDeleted ? (
                      <span className="text-xs">{task.status}</span>
                    ) : (
                      <select
                        value={task.status}
                        onChange={(e) => handleTaskUpdate(task.id, { status: e.target.value })}
                        disabled={busyTaskId === task.id}
                        aria-label={`Status for ${task.title}`}
                        className="border border-input rounded px-2 py-1 text-xs bg-background"
                      >
                        <option value="todo">todo</option>
                        <option value="in-progress">in-progress</option>
                        <option value="review">review</option>
                        <option value="done">done</option>
                      </select>
                    )}
                  </td>
                  <td className="py-3 text-sm">{task.priority}</td>
                  <td className="py-3 text-sm text-muted-foreground">
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-3 text-right text-sm text-muted-foreground">
                    {task.estimatedHours ?? '—'}
                  </td>
                  <td className="py-3 text-right whitespace-nowrap space-x-2">
                    <Link
                      href={`/projects/tasks/${task.id}/comments`}
                      className="text-xs text-accent hover:underline"
                    >
                      Comments
                    </Link>
                    {!isDeleted && editingTaskId === task.id && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            handleTaskUpdate(task.id, {
                              title: editTitle,
                              assigneeId: editAssigneeId || null,
                              milestoneId: editMilestoneId || null,
                              priority: editPriority,
                              dueDate: editDueDate || null,
                              estimatedHours: editEstimatedHours.trim() || null,
                            })
                          }
                          disabled={busyTaskId === task.id}
                          className="text-xs text-accent font-medium hover:underline"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTaskId(null)}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {!isDeleted && editingTaskId !== task.id && (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditing(task)}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTask(task.id)}
                          disabled={busyTaskId === task.id}
                          className="text-xs text-destructive hover:underline"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
