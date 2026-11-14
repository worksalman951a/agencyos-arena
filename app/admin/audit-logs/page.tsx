/**
 * AgencyOS Audit Log Viewer page.
 *
 * Server-rendered from the query string (`?action=&entityType=&entityId=&page=`),
 * so the view is shareable, survives a refresh and has no client cache between
 * it and the database. Filters are applied server-side and the result set is
 * paginated. Bifurcated under useBentoShell().
 */

import { listAuditLogs } from '@/lib/services/admin/audit-log-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { AuditLogsClient } from './audit-logs-client';

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

  // Pagination links are rebuilt inside the Client Component from these plain
  // strings. A `hrefBuilder` closure cannot cross the Server/Client boundary -
  // React refuses to serialise functions and the page 500s.
  return (
    <AuditLogsClient
      logs={logs}
      total={total}
      currentPage={currentPage}
      totalPages={totalPages}
      actions={actions}
      currentAction={action}
      currentEntityType={entityType}
      isFiltered={isFiltered}
    />
  );
}
