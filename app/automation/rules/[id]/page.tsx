/**
 * AgencyOS Workflow Rule detail page.
 *
 * Server-rendered (previous version was a client component that fetched with no
 * credentials, so it always showed a 401 error). Shows the rule, its execution
 * history with per-action results, and offers a retry for failed executions.
 */

import Link from 'next/link';

import {
  getWorkflowRule,
  listWorkflowExecutions,
} from '@/lib/services/automation/workflow-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { RetryExecutionButton } from './RetryExecutionButton';

export default async function WorkflowRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await loadPageData(async () => {
    const rule = await getWorkflowRule(id);
    const executions = await listWorkflowExecutions(id);
    return { rule, executions };
  });

  if (!result.ok) return <PageStateNotice reason={result.reason} />;

  const { rule, executions } = result.data;
  const actions = (rule.actions as { list?: Array<{ type: string; title?: string }> }).list ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{rule.name}</h1>
          <p className="text-sm text-muted-foreground font-mono">{rule.trigger}</p>
        </div>
        <Link
          href="/automation/rules"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to rules
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-md border bg-background p-4 text-sm">
          <p className="font-medium mb-2">Conditions</p>
          <pre className="text-xs overflow-x-auto bg-muted/40 p-2 rounded">
            {JSON.stringify(rule.conditions, null, 2)}
          </pre>
        </div>
        <div className="rounded-md border bg-background p-4 text-sm">
          <p className="font-medium mb-2">Actions</p>
          <ul className="list-disc pl-5 space-y-1">
            {actions.length === 0 ? <li>No actions</li> : null}
            {actions.map((action, index) => (
              <li key={index}>
                <span className="font-mono text-xs">{action.type}</span>
                {action.title ? ` — ${action.title}` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Status: {rule.enabled ? 'Enabled' : 'Disabled'}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <h2 className="text-lg font-semibold mb-3">Execution history</h2>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Record</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Attempts</th>
              <th className="pb-3 font-medium">Result</th>
              <th className="pb-3 font-medium text-right">When</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {executions.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  No executions yet. Rules run when an event is dispatched for a record.
                </td>
              </tr>
            ) : (
              executions.map((execution) => (
                <tr
                  key={execution.id}
                  className="border-b border-border hover:bg-muted/50 align-top"
                >
                  <td className="py-4 text-sm">
                    {execution.recordType}
                    <span className="block text-xs text-muted-foreground font-mono">
                      {execution.recordId}
                    </span>
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        execution.status === 'succeeded'
                          ? 'bg-green-100 text-green-800'
                          : execution.status === 'failed'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {execution.status}
                    </span>
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">{execution.attempts}</td>
                  <td className="py-4 text-xs text-muted-foreground max-w-md">
                    <code className="break-all">
                      {JSON.stringify(execution.resultLog ?? {}).slice(0, 240)}
                    </code>
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(execution.createdAt).toLocaleString()}
                  </td>
                  <td className="py-4 text-right">
                    {execution.status === 'failed' ? (
                      <RetryExecutionButton executionId={execution.id} />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
