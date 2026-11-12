'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExportDocumentPdfButton } from '@/components/documents/export-document-pdf-button';
import { ShareDocumentButton } from '@/components/documents/share-document-button';
import { ProposalActions } from './ProposalActions';
import {
  BentoProposalRecordView,
  type ProposalDetailData,
} from '@/components/sales/bento-proposal-record-view';
import type { ProposalVersionResponse } from '@/lib/services/documents/version-service';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

interface ProposalDetailClientProps {
  proposal: ProposalDetailData;
  versions: ProposalVersionResponse[];
}

export function ProposalDetailClient({ proposal, versions }: ProposalDetailClientProps) {
  const isBento = useBentoShell();
  const EDITABLE_STATUSES = ['draft', 'sent'];
  const contactName = proposal.contact
    ? `${proposal.contact.firstName ?? ''} ${proposal.contact.lastName ?? ''}`.trim() ||
      'Unnamed Contact'
    : null;

  if (isBento) {
    return (
      <BentoProposalRecordView
        proposal={proposal}
        versions={versions}
        actionsNode={<ProposalActions proposalId={proposal.id} status={proposal.status} />}
      />
    );
  }

  // Legacy Presentation
  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{proposal.title}</h1>
          <p className="text-muted-foreground">
            #{proposal.number} &bull; {proposal.status} &bull; {proposal.currency}{' '}
            {Number(proposal.total).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            &bull;{' '}
            {proposal.validUntil ? new Date(proposal.validUntil).toLocaleDateString() : 'No expiry'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportDocumentPdfButton
            documentKind="PROPOSAL"
            documentId={proposal.id}
            number={proposal.number}
            title={proposal.title}
            status={proposal.status}
            currency={proposal.currency}
            createdAt={proposal.createdAt}
            validUntil={proposal.validUntil}
            clientName={contactName}
            opportunityTitle={proposal.opportunity?.title}
            subtotal={String(proposal.subtotal)}
            tax={String(proposal.tax)}
            total={String(proposal.total)}
            notes={proposal.notes}
            items={proposal.items.map((it) => ({
              description: it.description,
              quantity: String(it.quantity),
              unitPrice: String(it.unitPrice),
              taxRate: String(it.taxRate),
              amount: String(it.amount),
            }))}
          />
          <ShareDocumentButton entityType="proposal" entityId={proposal.id} />
          {EDITABLE_STATUSES.includes(proposal.status) && (
            <Button asChild variant="outline">
              <Link href={`/sales/proposals/builder/${proposal.id}`}>Edit</Link>
            </Button>
          )}
          <ProposalActions proposalId={proposal.id} status={proposal.status} />
          <Button asChild variant="outline">
            <Link href="/sales/proposals">Back</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Metadata</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Number</dt>
              <dd className="font-mono font-medium">{proposal.number}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="font-medium capitalize">{proposal.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd>{new Date(proposal.createdAt).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valid Until</dt>
              <dd>
                {proposal.validUntil ? new Date(proposal.validUntil).toLocaleDateString() : '—'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Linked CRM</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Opportunity</dt>
              <dd>
                {proposal.opportunity ? (
                  <Link
                    href={`/crm/opportunities/${proposal.opportunity.id}`}
                    className="text-accent hover:underline font-medium"
                  >
                    {proposal.opportunity.title}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Contact</dt>
              <dd>
                {proposal.contact ? (
                  <Link
                    href={`/crm/contacts/${proposal.contact.id}`}
                    className="text-accent hover:underline font-medium"
                  >
                    {contactName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Financial Summary</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Subtotal</dt>
              <dd className="font-mono font-medium">
                {proposal.currency}{' '}
                {Number(proposal.subtotal).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tax</dt>
              <dd className="font-mono font-medium">
                {proposal.currency}{' '}
                {Number(proposal.tax).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
            <div className="pt-2 border-t">
              <dt className="text-xs text-muted-foreground font-semibold">Total</dt>
              <dd className="font-mono text-lg font-bold">
                {proposal.currency}{' '}
                {Number(proposal.total).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="bg-card p-6 rounded-lg border border-border space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Line Items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Description</th>
                <th className="pb-2 font-medium text-right">Qty</th>
                <th className="pb-2 font-medium text-right">Unit Price</th>
                <th className="pb-2 font-medium text-right">Tax Rate</th>
                <th className="pb-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {proposal.items.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0">
                  <td className="py-2.5 font-medium">{item.description}</td>
                  <td className="py-2.5 text-right font-mono">{Number(item.quantity)}</td>
                  <td className="py-2.5 text-right font-mono">
                    {proposal.currency} {Number(item.unitPrice).toLocaleString()}
                  </td>
                  <td className="py-2.5 text-right font-mono">{Number(item.taxRate)}%</td>
                  <td className="py-2.5 text-right font-mono font-medium">
                    {proposal.currency} {Number(item.amount).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {proposal.notes && (
        <div className="bg-card p-6 rounded-lg border border-border space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Notes</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{proposal.notes}</p>
        </div>
      )}
    </div>
  );
}
