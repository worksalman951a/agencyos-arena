/**
 * AgencyOS Audit Log Viewer page.
 * Displays organization audit trail for compliance and debugging.
 */

import { listAuditLogs } from '@/lib/services/admin/audit-log-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export default async function AuditLogsPage() {
  const result = await loadPageData(() => listAuditLogs());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const logs = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          Organization activity trail for compliance and debugging.
        </p>
      </div>

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
            {(
              logs as Array<{
                id: string;
                actorName: string | null;
                action: string;
                entityType: string;
                entityId: string;
                createdAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No audit log entries found.
                </td>
              </tr>
            ) : (
              (
                logs as Array<{
                  id: string;
                  actorName: string | null;
                  action: string;
                  entityType: string;
                  entityId: string;
                  createdAt: Date;
                }>
              ).map((log) => (
                <tr key={log.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium text-sm">{log.actorName || 'System'}</td>
                  <td className="py-4 text-sm font-mono">{log.action}</td>
                  <td className="py-4 text-sm text-muted-foreground">{log.entityType}</td>
                  <td className="py-4 text-sm text-muted-foreground">{log.entityId}</td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(log.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border bg-background p-4">
        <h3 className="text-sm font-semibold mb-2">About Audit Logs</h3>
        <p className="text-sm text-muted-foreground">
          All mutations (create, update, delete) across the platform are recorded here with actor,
          action, entity, and timestamp. Audit logs are append-only and cannot be modified.
        </p>
      </div>
    </div>
  );
}
