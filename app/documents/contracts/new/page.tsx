/**
 * AgencyOS Documents - New Contract
 * Client component form for creating a new contract with Proposal and Project selectors.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

export default function NewContractPage() {
  const router = useRouter();
  const isBento = useBentoShell();
  const [proposals, setProposals] = useState<ProposalOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [proposalId, setProposalId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('draft');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function init() {
      const search = new URLSearchParams(window.location.search);
      const qProposalId = search.get('proposalId');
      const qProjectId = search.get('projectId');
      const qTitle = search.get('title');

      const [propRes, projRes] = await Promise.all([
        fetch('/api/v1/crm/proposals?pageSize=100').catch(() => null),
        fetch('/api/v1/projects?pageSize=100').catch(() => null),
      ]);

      if (!active) return;
      if (qProposalId) setProposalId(qProposalId);
      if (qProjectId) setProjectId(qProjectId);
      if (qTitle) setTitle(qTitle);

      if (propRes?.ok) {
        const pData = (await propRes.json()) as { proposals?: ProposalOption[] } | ProposalOption[];
        const list = Array.isArray(pData) ? pData : (pData.proposals ?? []);
        setProposals(list);
        if (qProposalId && !qTitle) {
          const matched = list.find((p) => p.id === qProposalId);
          if (matched) setTitle(`${matched.title} Agreement`);
        }
      }
      if (projRes?.ok) {
        const prData = (await projRes.json()) as { projects?: ProjectOption[] } | ProjectOption[];
        const list = Array.isArray(prData) ? prData : (prData.projects ?? []);
        setProjects(list);
      }
    }

    void init();

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/documents/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposalId || undefined,
          projectId: projectId || undefined,
          title: title.trim(),
          status,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create contract' }));
        throw new Error((err as { error?: string }).error || 'Failed to create contract');
      }

      const data = await res.json();
      toast.success('Contract created');
      router.push(`/documents/contracts/${data.id}`);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (isBento) {
    return (
      <BentoContractFormView
        mode="new"
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
        onSubmit={handleSubmit}
        isLoading={loading}
        error={error}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">New Contract</h1>
          <p className="text-muted-foreground">
            Create a contract linked to a proposal or project.
          </p>
        </div>
        <Link
          href="/documents/contracts"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to Contracts
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="contract-title" className="block text-sm font-medium">
              Contract Title <span className="text-destructive">*</span>
            </label>
            <input
              id="contract-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              placeholder="e.g. Master Services Agreement"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="contract-proposal" className="block text-sm font-medium">
                Linked Proposal
              </label>
              <select
                id="contract-proposal"
                value={proposalId}
                onChange={(e) => setProposalId(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="">None (standalone contract)</option>
                {proposals.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.number} — {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="contract-project" className="block text-sm font-medium">
                Linked Project
              </label>
              <select
                id="contract-project"
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
            <label htmlFor="contract-status" className="block text-sm font-medium">
              Initial Status
            </label>
            <select
              id="contract-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
            </select>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className={`px-6 py-2 rounded-md text-sm font-medium disabled:opacity-50 ${
                loading
                  ? 'bg-muted cursor-not-allowed'
                  : 'bg-accent text-accent-foreground hover:bg-accent/90'
              }`}
            >
              {loading ? 'Creating...' : 'Create Contract'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
