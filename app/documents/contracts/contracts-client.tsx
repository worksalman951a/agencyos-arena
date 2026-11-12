'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoContractsView, type ContractItem } from '@/components/documents/bento-contracts-view';

interface ContractsClientProps {
  contracts: ContractItem[];
}

export function ContractsClient({ contracts }: ContractsClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoContractsView contracts={contracts} />;
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Contracts</h1>
          <p className="text-muted-foreground">
            Manage contracts linked to proposals and projects.
          </p>
        </div>
        <Link
          href="/documents/contracts/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Contract
        </Link>
      </div>

      {contracts.length === 0 ? (
        <div className="rounded-md border bg-background p-6 text-center space-y-3">
          <h2 className="text-lg font-semibold">No contracts yet</h2>
          <p className="text-muted-foreground">
            Create your first contract from a proposal or project.
          </p>
          <div>
            <Link
              href="/documents/contracts/new"
              className="inline-block mt-2 px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Create Contract
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-md border bg-background p-6 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b text-sm">
                <th className="pb-3 font-medium text-muted-foreground">Title</th>
                <th className="pb-3 font-medium text-muted-foreground">Status</th>
                <th className="pb-3 font-medium text-muted-foreground">Proposal</th>
                <th className="pb-3 font-medium text-muted-foreground">Project</th>
                <th className="pb-3 font-medium text-muted-foreground">Signed Date</th>
                <th className="pb-3 font-medium text-muted-foreground">Signer</th>
              </tr>
            </thead>
            <tbody className="divide-y text-sm">
              {contracts.map((contract) => (
                <tr key={contract.id} className="hover:bg-muted/50">
                  <td className="py-3 font-medium">
                    <Link
                      href={`/documents/contracts/${contract.id}`}
                      className="text-accent hover:underline"
                    >
                      {contract.title}
                    </Link>
                  </td>
                  <td className="py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        contract.status === 'signed'
                          ? 'bg-green-100 text-green-800'
                          : contract.status === 'sent'
                            ? 'bg-blue-100 text-blue-800'
                            : contract.status === 'voided'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {contract.status}
                    </span>
                  </td>
                  <td className="py-3">
                    {contract.proposal ? (
                      <Link
                        href={`/sales/proposals/${contract.proposal.id}`}
                        className="text-accent hover:underline text-xs"
                      >
                        #{contract.proposal.number} — {contract.proposal.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3">
                    {contract.project ? (
                      <Link
                        href={`/projects/${contract.project.id}`}
                        className="text-accent hover:underline text-xs"
                      >
                        {contract.project.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 text-muted-foreground text-xs">
                    {contract.signedAt ? new Date(contract.signedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-3 text-muted-foreground text-xs">
                    {contract.signer ? contract.signer.name || contract.signer.email : '—'}
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
