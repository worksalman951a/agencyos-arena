/**
 * AgencyOS Documents - Edit Contract
 * Client component form for editing draft or sent contracts.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoContractFormView } from '@/components/documents/bento-contract-form-view';

interface ProposalOption {
  id: string;
  number: string;
  title: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

export default function EditContractPage() {
  const router = useRouter();
  const isBento = useBentoShell();
  const routeParams = useParams<{ id: string }>();
  const rawId: unknown = routeParams?.id;
  const id = typeof rawId === 'string' ? rawId : '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [proposalId, setProposalId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('draft');
  const [savedStatus, setSavedStatus] = useState('draft');
  const [proposals, setProposals] = useState<ProposalOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;

    Promise.all([
      fetch(`/api/v1/documents/contracts/${encodeURIComponent(id)}`),
      fetch('/api/v1/crm/proposals?pageSize=100').catch(() => null),
      fetch('/api/v1/projects?pageSize=100').catch(() => null),
    ])
      .then(async ([contractRes, propRes, projRes]) => {
        if (!active) return;
        if (!contractRes.ok) {
          throw new Error('Failed to load contract');
        }
        const contract = await contractRes.json();
        setTitle(contract.title || '');
        setProposalId(contract.proposalId || '');
        setProjectId(contract.projectId || '');
        setStatus(contract.status || 'draft');
        setSavedStatus(contract.status || 'draft');

        if (propRes?.ok) {
          const pData = (await propRes.json()) as
            { proposals?: ProposalOption[] } | ProposalOption[];
          setProposals(Array.isArray(pData) ? pData : (pData.proposals ?? []));
        }
        if (projRes?.ok) {
          const prData = (await projRes.json()) as { projects?: ProjectOption[] } | ProjectOption[];
          setProjects(Array.isArray(prData) ? prData : (prData.projects ?? []));
        }
      })
      .catch((err) => {
        toast.error((err as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  const isLocked = savedStatus === 'signed' || savedStatus === 'voided';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLocked) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/documents/contracts/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          proposalId: proposalId || null,
          projectId: projectId || null,
          status,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to update contract');
      }
      toast.success('Contract updated');
      router.push(`/documents/contracts/${id}`);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading contract…</div>;
  }

  if (isBento) {
    return (
      <BentoContractFormView
        mode="edit"
        contractId={id}
        title={title}
        setTitle={setTitle}
        proposalId={proposalId}
        setProposalId={setProposalId}
        proposals={proposals}
        projectId={projectId}
        setProjectId={setProjectId}
        projects={projects}
        status={status}
        setStatus={setStatus}
        isLocked={isLocked}
        savedStatus={savedStatus}
        onSubmit={handleSubmit}
        isLoading={saving}
        error={error}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit Contract</h1>
        <Link
          href={id ? `/documents/contracts/${id}` : '/documents/contracts'}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      {isLocked ? (
        <div className="rounded-md border bg-amber-50 p-6 max-w-2xl space-y-3">
          <h2 className="text-base font-semibold text-amber-900">Contract is {savedStatus}</h2>
          <p className="text-sm text-amber-800">
            Signed and voided contracts are immutable to preserve execution records.
          </p>
          <Link
            href={`/documents/contracts/${id}`}
            className="inline-block px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Contract
          </Link>
        </div>
      ) : (
        <div className="rounded-md border bg-background p-6 max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="edit-contract-title" className="block text-sm font-medium">
                Contract Title
              </label>
              <input
                id="edit-contract-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="edit-contract-proposal" className="block text-sm font-medium">
                  Linked Proposal
                </label>
                <select
                  id="edit-contract-proposal"
                  value={proposalId}
                  onChange={(e) => setProposalId(e.target.value)}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                >
                  <option value="">None</option>
                  {proposals.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.number} — {p.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="edit-contract-project" className="block text-sm font-medium">
                  Linked Project
                </label>
                <select
                  id="edit-contract-project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                >
                  <option value="">None</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="edit-contract-status" className="block text-sm font-medium">
                Status
              </label>
              <select
                id="edit-contract-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                {savedStatus === 'draft' && <option value="draft">Draft</option>}
                <option value="sent">Sent</option>
                <option value="voided">Voided</option>
              </select>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
