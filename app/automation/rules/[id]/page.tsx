/**
 * AgencyOS Workflow Rule detail page.
 *
 * Server-rendered. Shows the rule, its execution history with per-action results,
 * and offers a retry for failed executions. Bifurcated under useBentoShell().
 */

import {
  getWorkflowRule,
  listWorkflowExecutions,
} from '@/lib/services/automation/workflow-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { WorkflowRuleDetailClient } from './workflow-rule-detail-client';

export default async function WorkflowRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await loadPageData(async () => {
    const rule = await getWorkflowRule(id);
    const executions = await listWorkflowExecutions(id);
    return { rule, executions };
  });

  if (!result.ok) return <PageStateNotice reason={result.reason} />;

  const { rule, executions } = result.data;

  return <WorkflowRuleDetailClient rule={rule} executions={executions} />;
}
