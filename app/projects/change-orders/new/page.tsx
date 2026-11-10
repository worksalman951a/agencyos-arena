/**
 * AgencyOS New Change Order page.
 * Client component form for creating a new change order using real project
 * and team member selectors.
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

interface ProjectOption {
  id: string;
  name: string;
}

interface MemberOption {
  id: string;
  name: string | null;
  email: string;
}

function NewChangeOrderFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get('projectId') ?? '';

  const [projectId, setProjectId] = useState(initialProjectId);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('pending');
  const [approvedBy, setApprovedBy] = useState('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/v1/crm/projects?pageSize=100&sortBy=name&sortOrder=asc').then((r) =>
        r.ok ? r.json() : null
      ),
      fetch('/api/v1/projects/members').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([projData, memData]) => {
        if (!active) return;
        if (projData && Array.isArray(projData.projects)) {
          setProjects(projData.projects);
        }
        if (memData && Array.isArray(memData.members)) {
          setMembers(memData.members);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/v1/projects/change-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          description,
          amount,
          status,
          approvedBy: approvedBy || null,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to create change order');
      }

      const data = (await res.json()) as { id: string };
      toast.success('Change order created');
      router.push(`/projects/change-orders/${data.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">New Change Order</h1>
        <Link
          href={
            initialProjectId
              ? `/projects/change-orders?projectId=${encodeURIComponent(initialProjectId)}`
              : '/projects/change-orders'
          }
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="space-y-2">
          <label htmlFor="co-project" className="text-sm font-medium">
            Project
          </label>
          <select
            id="co-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            required
          >
            <option value="">Select a project…</option>
            {projectId && !projects.some((p) => p.id === projectId) && (
              <option value={projectId}>Selected project</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="co-description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="co-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe the scope change..."
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label htmlFor="co-amount" className="text-sm font-medium">
              Amount
            </label>
            <input
              id="co-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full border border-input rounded-md px-3 py-2 text-sm text-right bg-background"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="co-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="co-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="co-approver" className="text-sm font-medium">
              Approved By (optional)
            </label>
            <select
              id="co-approver"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="">Unassigned / Auto on approval</option>
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
          disabled={loading}
          className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {loading ? 'Creating...' : 'Create Change Order'}
        </button>
      </form>
    </div>
  );
}

export default function NewChangeOrderPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading form…</div>}>
      <NewChangeOrderFormInner />
    </Suspense>
  );
}
