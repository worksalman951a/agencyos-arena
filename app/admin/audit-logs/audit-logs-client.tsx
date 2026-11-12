'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoAuditLogsView } from '@/components/admin/bento-audit-logs-view';
import type { AuditLogResponse } from '@/lib/services/admin/audit-log-service';

interface AuditLogsClientProps {
  logs: AuditLogResponse[];
  total: number;
  currentPage: number;
  totalPages: number;
  actions: string[];
  currentAction?: string;
  currentEntityType?: string;
  isFiltered: boolean;
  hrefBuilder: (page: number) => string;
}

export function AuditLogsClient({
  logs,
  total,
  currentPage,
  totalPages,
  actions,
  currentAction,
  currentEntityType,
  isFiltered,
  hrefBuilder,
}: AuditLogsClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return (
      <BentoAuditLogsView
        logs={logs}
        total={total}
        currentPage={currentPage}
        totalPages={totalPages}
        actions={actions}
        currentAction={currentAction}
        currentEntityType={currentEntityType}
        hrefBuilder={hrefBuilder}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Organization activity trail for compliance and debugging.
          </p>
        </div>
        <span className="text-sm text-muted-foreground" data-testid="audit-total">
          {total} {total === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      <form
        method="get"
        action="/admin/audit-logs"
        className="rounded-md border bg-background p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
      >
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="action">
            Action
          </label>
          <select
            id="action"
            name="action"
            defaultValue={currentAction ?? ''}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
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
            Entity
          </label>
          <input
            id="entityType"
            name="entityType"
            defaultValue={currentEntityType ?? ''}
            placeholder="WorkflowRule, User, Invitation…"
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            Filter
          </button>
          {isFiltered && (
            <Link
              href="/admin/audit-logs"
              className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              Reset
            </Link>
          )}
        </div>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">When</th>
              <th className="pb-3 font-medium">Actor</th>
              <th className="pb-3 font-medium">Action</th>
              <th className="pb-3 font-medium">Entity</th>
              <th className="pb-3 font-medium">Entity ID</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  {isFiltered
                    ? 'No audit log entries match the filter.'
                    : 'No audit log entries yet.'}
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="py-4 text-sm">{log.actorName || log.actorId}</td>
                  <td className="py-4 text-sm font-mono">{log.action}</td>
                  <td className="py-4 text-sm">{log.entityType}</td>
                  <td className="py-4 text-xs font-mono text-muted-foreground">{log.entityId}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-4">
          <div>
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex gap-2">
            {currentPage > 1 && (
              <Link
                href={hrefBuilder(currentPage - 1)}
                className="px-3 py-1.5 border rounded-md text-sm hover:bg-muted"
              >
                Previous
              </Link>
            )}
            {currentPage < totalPages && (
              <Link
                href={hrefBuilder(currentPage + 1)}
                className="px-3 py-1.5 border rounded-md text-sm hover:bg-muted"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
