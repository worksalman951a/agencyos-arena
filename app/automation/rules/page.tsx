/**
 * AgencyOS Workflow Rules page.
 * Lists and creates automation workflow rules.
 */

import { listWorkflowRules } from '@/lib/services/automation/workflow-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { WorkflowRulesClient } from './workflow-rules-client';

export default async function WorkflowRulesPage() {
  const result = await loadPageData(() => listWorkflowRules());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const workflows = result.data;

  return <WorkflowRulesClient workflows={workflows} />;
}
