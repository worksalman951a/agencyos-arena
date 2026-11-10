/**
 * AgencyOS Audit Log Viewer page.
 *
 * Server-rendered from the query string (`?action=&entityType=&entityId=&page=`),
 * so the view is shareable, survives a refresh and has no client cache between
 * it and the database. Filters are applied server-side and the result set is
 * paginated — the previous version showed the newest 100 rows with no way to
 * narrow them down.
 */

import Link from 'next/link';

import { listAuditLogs } from '@/lib/services/admin/audit-log-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { action: actionParam, entityType: entityTypeParam, page: pageParam } = await searchParams;
  const action = first(actionParam);
  const entityType = first(entityTypeParam);
  const page = Number(first(pageParam) || '1');

  const result = await loadPageData(() =>
    listAuditLogs({
      action: action || undefined,
      entityType: entityType || undefined,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: 25,
    })
  );

  if (!result.ok) return <PageStateNotice reason={result.reason} />;

  const { logs, total, page: currentPage, totalPages, actions } = result.data;
  const isFiltered = Boolean(action || entityType);

  const href = (nextPage: number) => {
    const query = new URLSearchParams();
    if (action) query.set('action', action);
    if (entityType) query.set('entityType', entityType);
    if (nextPage > 1) query.set('page', String(nextPage));
    const qs = query.toString();
    return qs ? `/admin/audit-logs?${qs}` : '/admin/audit-logs';
  };

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
            defaultValue={action}
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
            defaultValue={entityType}
            placeholder="WorkflowRule, User, Invitation…"
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          Apply filters
        </button>
        {isFiltered ? (
          <Link
            href="/admin/audit-logs"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm text-center font-medium hover:bg-muted/80"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Actor</th>
              <th className="pb-3 font-medium">Action</th>
              <th className="pb-3 font-medium">Entity Type</th>
              <th className="pb-3 font-medium">Entity ID</th>
              <th className="pb-3 font-medium text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  {isFiltered
                    ? 'No audit entries match these filters.'
                    : 'No audit log entries found.'}
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 text-sm">{log.actor?.name ?? log.actorName ?? 'System'}</td>
                  <td className="py-4 text-sm font-medium">{log.action}</td>
                  <td className="py-4 text-sm text-muted-foreground">{log.entityType}</td>
                  <td className="py-4 text-sm text-muted-foreground font-mono">{log.entityId}</td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          {currentPage > 1 ? (
            <Link
              href={href(currentPage - 1)}
              className="px-3 py-1.5 border rounded-md hover:bg-muted"
            >
              Previous
            </Link>
          ) : (
            <span className="px-3 py-1.5 border rounded-md opacity-50">Previous</span>
          )}
          {currentPage < totalPages ? (
            <Link
              href={href(currentPage + 1)}
              className="px-3 py-1.5 border rounded-md hover:bg-muted"
            >
              Next
            </Link>
          ) : (
            <span className="px-3 py-1.5 border rounded-md opacity-50">Next</span>
          )}
        </div>
      </div>
    </div>
  );
}
