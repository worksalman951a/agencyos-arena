'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Eye } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { ChangeOrderResponse } from '@/lib/services/projects/change-order-service';
import '@/components/crm/bento-contacts.css';

interface BentoChangeOrdersViewProps {
  changeOrders: ChangeOrderResponse[];
  projectId?: string;
}

export function BentoChangeOrdersView({ changeOrders, projectId }: BentoChangeOrdersViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeOrder =
    changeOrders[Math.min(selectedIdx, Math.max(0, changeOrders.length - 1))] ?? null;

  const totalValue = changeOrders.reduce((sum, co) => sum + Number(co.amount || 0), 0);
  const approvedOrders = changeOrders.filter((co) => co.status === 'approved');
  const approvedTotal = approvedOrders.reduce((sum, co) => sum + Number(co.amount || 0), 0);
  const pendingOrders = changeOrders.filter((co) => co.status === 'pending');
  const pendingTotal = pendingOrders.reduce((sum, co) => sum + Number(co.amount || 0), 0);

  const getStatusTone = (status: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (status.toLowerCase()) {
      case 'approved':
        return 'ok';
      case 'pending':
        return 'warn';
      case 'rejected':
        return 'danger';
      default:
        return undefined;
    }
  };

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Projects</span>
            <span>/</span>
            <span>Financials & Scope Variance</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Change Orders</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Scope modifications, financial variances, and authorized budget adjustments
          </p>
        </div>

        <div className="flex items-center gap-2">
          {projectId && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${projectId}`}>Back to Workspace</Link>
            </Button>
          )}
          <Button asChild className="bg-accent text-accent-foreground" size="sm">
            <Link
              href={
                projectId
                  ? `/projects/change-orders/new?projectId=${encodeURIComponent(projectId)}`
                  : '/projects/change-orders/new'
              }
            >
              <Plus size={14} className="mr-1.5" />
              New Change Order
            </Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Approved Scope Total',
            value: `$${approvedTotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
            note: `${approvedOrders.length} approved change orders`,
            tone: 'ok',
          },
          {
            label: 'Pending Approval',
            value: `$${pendingTotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
            note: `${pendingOrders.length} orders under review`,
            tone: pendingOrders.length > 0 ? 'warn' : undefined,
          },
          {
            label: 'Total Orders',
            value: String(changeOrders.length),
            note: `$${totalValue.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} total registered variance`,
          },
        ]}
      />

      {/* ── Change Orders Grid & Inspector ───────────────────────────── */}
      {changeOrders.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No change orders recorded"
            sub="Scope variations and extra billables will appear here once submitted."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Change Orders Register (${changeOrders.length})`}>
              <div className="bento-sales-table-head">
                <span>Project / Scope Title</span>
                <span>Approver</span>
                <span className="text-right">Variance Amount</span>
                <span className="text-right">Created</span>
                <span className="text-right">Status</span>
              </div>

              <div className="divide-y divide-border/60">
                {changeOrders.map((co, idx) => {
                  const isSelected = activeOrder?.id === co.id;
                  const approver = co.approver
                    ? co.approver.name || co.approver.email || co.approvedBy || 'Approved'
                    : co.approvedBy || 'Awaiting Sign-off';

                  return (
                    <button
                      key={co.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {co.project?.name || `Project #${co.projectId.slice(0, 8)}`}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {co.description}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {approver}
                      </div>

                      <div className="text-xs font-mono font-bold text-foreground text-right">
                        $
                        {Number(co.amount || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>

                      <div className="text-xs text-muted-foreground text-right font-mono">
                        {new Date(co.createdAt).toLocaleDateString()}
                      </div>

                      <div className="text-right">
                        <StatusPill tone={getStatusTone(co.status)}>{co.status}</StatusPill>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeOrder ? (
              <Panel
                title="Change Order Details"
                action={
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link href={`/projects/change-orders/${activeOrder.id}`}>
                      View Full <Eye size={12} className="ml-1" />
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Scope Item
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">
                      {activeOrder.project?.name || `Project #${activeOrder.projectId.slice(0, 8)}`}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {activeOrder.description}
                    </p>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Financial Variance"
                      value={
                        <span className="font-mono font-bold text-sm text-foreground">
                          $
                          {Number(activeOrder.amount || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      }
                    />
                    <KeyValueRow
                      label="Approval Status"
                      value={
                        <StatusPill tone={getStatusTone(activeOrder.status)}>
                          {activeOrder.status}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Authorizing Officer"
                      value={
                        activeOrder.approver
                          ? activeOrder.approver.name ||
                            activeOrder.approver.email ||
                            activeOrder.approvedBy ||
                            'Approved'
                          : activeOrder.approvedBy || 'Pending'
                      }
                    />
                    <KeyValueRow
                      label="Created Date"
                      value={new Date(activeOrder.createdAt).toLocaleDateString()}
                    />
                  </div>

                  <div className="border-t border-border pt-3">
                    <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                      <Link href={`/projects/change-orders/${activeOrder.id}`}>
                        Manage Change Order
                      </Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
