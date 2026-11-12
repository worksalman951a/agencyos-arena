/**
 * AgencyOS Financial Reports page.
 *
 * Server component aggregating organization-scoped metrics and presenting them
 * via FinancialReportsClient (Bento vs Legacy UI).
 */

import { listEstimates } from '@/lib/services/crm/estimate-service';
import { listExpenses } from '@/lib/services/crm/expense-service';
import {
  getDashboardMetrics,
  getInvoiceStatusBreakdown,
} from '@/lib/services/dashboard/dashboard-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { FinancialReportsClient } from './reports-client';

async function fetchReportData() {
  const [metrics, statuses, estimates, expenses] = await Promise.all([
    getDashboardMetrics(),
    getInvoiceStatusBreakdown(),
    listEstimates(),
    listExpenses(),
  ]);

  if (!metrics.ok) {
    const error = new Error('Forbidden: insufficient permissions') as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }

  return {
    metrics: metrics.data,
    statuses: statuses.ok ? statuses.data : [],
    estimates,
    expenses,
  };
}

export default async function FinancialReportsPage() {
  const result = await loadPageData(fetchReportData);

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const { metrics, statuses, estimates, expenses } = result.data;

  return (
    <div className="space-y-6 p-6">
      <FinancialReportsClient
        metrics={metrics}
        statuses={statuses}
        estimates={estimates as Array<{ status: string; total: string; currency: string }>}
        expenses={expenses as Array<{ amount: string; billable: boolean }>}
      />
    </div>
  );
}
