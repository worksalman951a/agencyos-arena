/**
 * AgencyOS Change Orders page.
 * Lists change orders across the organization's projects (or filtered by projectId).
 */

import { listChangeOrders } from '@/lib/services/projects/change-order-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ChangeOrdersClient } from './change-orders-client';

export default async function ChangeOrdersPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await searchParamsPromise;
  const rawProjectId = Array.isArray(searchParams.projectId)
    ? searchParams.projectId[0]
    : searchParams.projectId;
  const projectId = rawProjectId || undefined;

  const result = await loadPageData(() => listChangeOrders(projectId));

  if (!result.ok) {
    return (
      <PageStateNotice reason={result.reason} backHref="/projects" backLabel="Back to projects" />
    );
  }

  const changeOrders = result.data;
  const totalApprovedAmount = changeOrders
    .filter((co) => co.status === 'approved')
    .reduce((sum, co) => sum + Number(co.amount || 0), 0);

  return (
    <ChangeOrdersClient
      changeOrders={changeOrders}
      projectId={projectId}
      totalApprovedAmount={totalApprovedAmount}
    />
  );
}
