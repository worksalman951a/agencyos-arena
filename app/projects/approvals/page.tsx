/**
 * AgencyOS Organization Approvals index page.
 * Lists project approvals across the organization.
 */

import { listProjectApprovals } from '@/lib/services/projects/project-approval-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ApprovalsClient } from './approvals-client';

export default async function AllProjectApprovalsPage() {
  const result = await loadPageData(() => listProjectApprovals());

  if (!result.ok) {
    return (
      <PageStateNotice reason={result.reason} backHref="/projects" backLabel="Back to projects" />
    );
  }

  const approvals = result.data;

  return <ApprovalsClient approvals={approvals} />;
}
