/**
 * AgencyOS Edit Change Order page.
 * Client component form for editing an existing change order.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoChangeOrderFormView } from '@/components/projects/bento-change-order-form-view';

interface MemberOption {
  id: string;
  name: string | null;
  email: string;
}

export default function EditChangeOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [id, setId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('pending');
  const [initialStatus, setInitialStatus] = useState('pending');
  const [approvedBy, setApprovedBy] = useState('');
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    params.then(async ({ id: pid }) => {
      if (!active) return;
      setId(pid);
      try {
        const [coRes, memRes] = await Promise.all([
          fetch(`/api/v1/projects/change-orders/${encodeURIComponent(pid)}`),
          fetch('/api/v1/projects/members'),
        ]);

        if (!coRes.ok) {
          const err = (await coRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || 'Failed to load change order');
        }

        const data = (await coRes.json()) as {
          projectId: string;
          project?: { name: string } | null;
          description: string;
          amount: string;
          status: string;
          approvedBy: string | null;
        };

        if (!active) return;
        setProjectId(data.projectId);
        setProjectName(data.project?.name ?? '');
        setDescription(data.description || '');
        setAmount(data.amount || '');
        setStatus(data.status || 'pending');
        setInitialStatus(data.status || 'pending');
        setApprovedBy(data.approvedBy || '');
        setLoadError(null);

        if (memRes.ok) {
          const memData = (await memRes.json()) as { members?: MemberOption[] };
          if (active && Array.isArray(memData.members)) {
            setMembers(memData.members);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/change-orders/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description || undefined,
          amount: amount || undefined,
          status,
          approvedBy: approvedBy || null,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to update change order');
      }

      toast.success('Change order updated');
      router.push('/projects/change-orders');
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
    if (!window.confirm('Delete this change order? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/v1/projects/change-orders/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to delete change order');
      }
      toast.success('Change order deleted');
      router.push('/projects/change-orders');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading change order…</div>;
  }

  if (loadError) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
        <Link href="/projects/change-orders" className="text-sm text-accent hover:underline">
          Back to Change Orders
        </Link>
      </div>
    );
  }

  const isTerminal = initialStatus === 'approved' || initialStatus === 'rejected';

  if (isBento) {
    return (
      <BentoChangeOrderFormView
        mode="edit"
        changeOrderId={id}
        projectId={projectId}
        projectName={projectName}
        description={description}
        setDescription={setDescription}
        amount={amount}
        setAmount={setAmount}
        status={status}
        setStatus={setStatus}
        isTerminalStatus={isTerminal}
        approvedBy={approvedBy}
        setApprovedBy={setApprovedBy}
        members={members}
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
        <div>
          <h1 className="text-2xl font-bold">Edit Change Order</h1>
          {projectId && (
            <Link href={`/projects/${projectId}`} className="text-sm text-accent hover:underline">
              {projectName || 'View Project'}
            </Link>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href="/projects/change-orders"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Cancel
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
        <div className="space-y-2">
          <label htmlFor="edit-co-description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="edit-co-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label htmlFor="edit-co-amount" className="text-sm font-medium">
              Amount
            </label>
            <input
              id="edit-co-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm text-right bg-background"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-co-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="edit-co-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={isTerminal}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background disabled:opacity-60"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            {isTerminal && (
              <p className="text-xs text-muted-foreground">
                Status is finalized ({initialStatus}) and cannot transition.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-co-approver" className="text-sm font-medium">
              Approved By (optional)
            </label>
            <select
              id="edit-co-approver"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ? `${m.name} (${m.email})` : m.email}
                </option>
              ))}
            </select>
          </div>
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
