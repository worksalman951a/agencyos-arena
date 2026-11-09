/**
 * AgencyOS Workflow Rules page.
 * Lists and creates automation workflow rules.
 */

import Link from 'next/link';
import { listWorkflowRules } from '@/lib/services/automation/workflow-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { NewWorkflowRuleForm } from './NewWorkflowRuleForm';

export default async function WorkflowRulesPage() {
  const result = await loadPageData(() => listWorkflowRules());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const workflows = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Workflow Rules</h1>
        <Link
          href="/automation/notifications"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Notifications
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-3xl">
        <h2 className="text-lg font-semibold mb-4">Create Workflow Rule</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Define trigger-based automation rules. Conditions and actions are stored as JSON.
        </p>
        <NewWorkflowRuleForm />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Trigger</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(
              workflows as Array<{
                id: string;
                name: string;
                trigger: string;
                conditions: Record<string, unknown>;
                actions: Record<string, unknown>;
                enabled: boolean;
                createdAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No workflow rules found. Create a rule to get started.
                </td>
              </tr>
            ) : (
              (
                workflows as Array<{
                  id: string;
                  name: string;
                  trigger: string;
                  conditions: Record<string, unknown>;
                  actions: Record<string, unknown>;
                  enabled: boolean;
                  createdAt: Date;
                }>
              ).map((w) => (
                <tr key={w.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">{w.name}</td>
                  <td className="py-4 text-sm text-muted-foreground font-mono">{w.trigger}</td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        w.enabled ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {w.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(w.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/automation/rules/${w.id}`}
                      className="text-sm text-accent hover:underline mr-2"
                    >
                      Edit
                    </Link>
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
