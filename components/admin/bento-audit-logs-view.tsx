'use client';

import * as React from 'react';
import Link from 'next/link';
import { Panel, EmptyState, KeyValueRow, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { AuditLogResponse } from '@/lib/services/admin/audit-log-service';
import { buildAuditLogPageHref } from '@/lib/admin/audit-log-links';
import '@/components/crm/bento-contacts.css';

interface BentoAuditLogsViewProps {
  logs: AuditLogResponse[];
  total: number;
  currentPage: number;
  totalPages: number;
  actions: string[];
  currentAction?: string;
  currentEntityType?: string;
}

export function BentoAuditLogsView({
  logs,
  total,
  currentPage,
  totalPages,
  actions,
  currentAction,
  currentEntityType,
}: BentoAuditLogsViewProps) {
  const pageHref = (nextPage: number) =>
    buildAuditLogPageHref(nextPage, { action: currentAction, entityType: currentEntityType });
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeLog = logs[Math.min(selectedIdx, Math.max(0, logs.length - 1))] ?? null;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Administration</span>
            <span>/</span>
            <span>Compliance & Security</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Audit Activity Log
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Immutable organization activity trail for compliance, governance, and security forensics
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/users">Users Directory</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/roles">Roles & Permissions</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Audit Entries',
            value: String(total),
            note: 'recorded lifecycle operations',
          },
          {
            label: 'Current Page',
            value: `${currentPage} of ${totalPages || 1}`,
            note: `viewing ${logs.length} entries on this page`,
          },
          {
            label: 'Filtered Action',
            value: currentAction || 'All Actions',
            note: currentEntityType ? `Scoped to ${currentEntityType}` : 'All entity types',
          },
        ]}
      />

      {/* ── Server Filter Form ──────────────────────────────────────── */}
      <Panel title="Filter Activity Trail">
        <form
          method="get"
          action="/admin/audit-logs"
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end"
        >
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="action">
              Action Code
            </label>
            <select
              id="action"
              name="action"
              defaultValue={currentAction ?? ''}
              className="w-full border border-input rounded-md px-3 py-1.5 text-xs bg-background"
            >
              <option value="">All actions</option>
              {actions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="entityType">
              Entity Classification
            </label>
            <input
              id="entityType"
              name="entityType"
              defaultValue={currentEntityType ?? ''}
              placeholder="User, Role, WorkflowRule…"
              className="w-full border border-input rounded-md px-3 py-1.5 text-xs bg-background"
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              className="h-8 text-xs bg-accent text-accent-foreground"
            >
              Filter Trail
            </Button>
            {(currentAction || currentEntityType) && (
              <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                <Link href="/admin/audit-logs">Reset</Link>
              </Button>
            )}
          </div>
        </form>
      </Panel>

      {/* ── Logs Grid & Inspector ───────────────────────────────────── */}
      {logs.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No audit entries match query"
            sub="Try clearing or adjusting the action code and entity filters above."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Audit Register (${logs.length})`}>
              <div className="bento-sales-table-head">
                <span>Action & Actor</span>
                <span>Target Entity</span>
                <span className="text-right">Timestamp</span>
              </div>

              <div className="divide-y divide-border/60">
                {logs.map((log, idx) => {
                  const isSelected = activeLog?.id === log.id;
                  const actor = log.actorName || log.actorId;

                  return (
                    <div
                      key={log.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedIdx(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedIdx(idx);
                        }
                      }}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {log.action}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          by {actor}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-mono text-foreground truncate">
                          {log.entityType}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground truncate">
                          {log.entityId}
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground text-right font-mono">
                        {new Date(log.createdAt).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <div>
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    {currentPage > 1 && (
                      <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                        <Link href={pageHref(currentPage - 1)}>Previous</Link>
                      </Button>
                    )}
                    {currentPage < totalPages && (
                      <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                        <Link href={pageHref(currentPage + 1)}>Next</Link>
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="min-w-0">
            {activeLog ? (
              <Panel title="Forensic Record Details">
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Audited Event
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5 font-mono">
                      {activeLog.action}
                    </h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Executing Actor"
                      value={activeLog.actorName || activeLog.actorId}
                    />
                    <KeyValueRow label="Entity Classification" value={activeLog.entityType} />
                    <KeyValueRow
                      label="Entity ID"
                      value={<code className="font-mono text-xs">{activeLog.entityId}</code>}
                    />
                    <KeyValueRow
                      label="Timestamp"
                      value={new Date(activeLog.createdAt).toLocaleString()}
                    />
                  </div>

                  {(activeLog.before || activeLog.after || activeLog.metadata) && (
                    <div className="border-t border-border pt-3 space-y-3">
                      {activeLog.metadata && (
                        <div>
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                            Event Metadata:
                          </span>
                          <pre className="text-xs overflow-x-auto bg-muted/40 p-2.5 rounded font-mono border border-border max-h-40">
                            {JSON.stringify(activeLog.metadata, null, 2)}
                          </pre>
                        </div>
                      )}

                      {activeLog.before && (
                        <div>
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                            State Before:
                          </span>
                          <pre className="text-xs overflow-x-auto bg-muted/40 p-2.5 rounded font-mono border border-border max-h-40">
                            {JSON.stringify(activeLog.before, null, 2)}
                          </pre>
                        </div>
                      )}

                      {activeLog.after && (
                        <div>
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                            State After:
                          </span>
                          <pre className="text-xs overflow-x-auto bg-muted/40 p-2.5 rounded font-mono border border-border max-h-40">
                            {JSON.stringify(activeLog.after, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
