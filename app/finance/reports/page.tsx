/**
 * AgencyOS Financial Reports page.
 * Server component showing revenue, outstanding, overdue, and profitability metrics.
 */

import { listInvoices } from '@/lib/services/crm/invoice-service';
import { listEstimates } from '@/lib/services/crm/estimate-service';
import { listExpenses } from '@/lib/services/crm/expense-service';
import { invoiceQuerySchema } from '@/lib/schemas/crm/invoice.schema';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

/**
 * Aggregate the reporting inputs through the service layer.
 *
 * Each service applies its own permission check and organization scoping, so
 * a section the user cannot read yields an empty list for that section instead
 * of failing the whole page (matching the previous best-effort behaviour, but
 * without the unserializable relative fetch).
 */
async function fetchFinanceData() {
  const [invoices, estimates, expenses] = await Promise.all([
    listInvoices(invoiceQuerySchema.parse({})).then((result) => result.invoices),
    listEstimates(),
    listExpenses(),
  ]);

  return { invoices, estimates, expenses };
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export default async function FinancialReportsPage() {
  const result = await loadPageData(fetchFinanceData);

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const { invoices, estimates, expenses } = result.data;

  const invList = invoices as Array<{ status: string; total: string; currency: string }>;
  const estList = estimates as Array<{ status: string; total: string }>;
  const expList = expenses as Array<{ amount: string; billable: boolean }>;

  const totalInvoiced = invList.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const paidInvoiced = invList
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const outstandingInvoiced = invList
    .filter((inv) => inv.status !== 'paid' && inv.status !== 'voided')
    .reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const overdueInvoiced = invList
    .filter((inv) => inv.status === 'overdue')
    .reduce((sum, inv) => sum + Number(inv.total || 0), 0);

  const totalEstimated = estList.reduce((sum, est) => sum + Number(est.total || 0), 0);
  const acceptedEstimated = estList
    .filter((est) => est.status === 'accepted')
    .reduce((sum, est) => sum + Number(est.total || 0), 0);

  const totalExpenses = expList.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
  const billableExpenses = expList
    .filter((exp) => exp.billable)
    .reduce((sum, exp) => sum + Number(exp.amount || 0), 0);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Financial Reports</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Total Invoiced</h2>
          <p className="text-3xl font-bold">{formatMoney(totalInvoiced)}</p>
          <p className="text-xs text-muted-foreground">All invoices</p>
        </div>

        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Paid</h2>
          <p className="text-3xl font-bold text-green-600">{formatMoney(paidInvoiced)}</p>
          <p className="text-xs text-muted-foreground">Paid invoices</p>
        </div>

        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Outstanding</h2>
          <p className="text-3xl font-bold text-amber-600">{formatMoney(outstandingInvoiced)}</p>
          <p className="text-xs text-muted-foreground">Unpaid invoices</p>
        </div>

        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Overdue</h2>
          <p className="text-3xl font-bold text-red-600">{formatMoney(overdueInvoiced)}</p>
          <p className="text-xs text-muted-foreground">Overdue invoices</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Estimates</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Total Estimated</dt>
              <dd className="font-medium">{formatMoney(totalEstimated)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Accepted</dt>
              <dd className="font-medium text-green-600">{formatMoney(acceptedEstimated)}</dd>
            </div>
            <div className="flex justify-between pt-2 border-t border-border">
              <dt className="text-muted-foreground">Conversion Rate</dt>
              <dd className="font-medium">
                {invList.length > 0
                  ? ((acceptedEstimated / totalInvoiced) * 100).toFixed(1) + '%'
                  : '—'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-md border bg-background p-4">
          <h2 className="text-lg font-semibold mb-2">Expenses</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Total Expenses</dt>
              <dd className="font-medium">{formatMoney(totalExpenses)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Billable Expenses</dt>
              <dd className="font-medium">{formatMoney(billableExpenses)}</dd>
            </div>
            <div className="flex justify-between pt-2 border-t border-border">
              <dt className="text-muted-foreground">Estimated Profit</dt>
              <dd className="font-medium">{formatMoney(paidInvoiced - totalExpenses)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="rounded-md border bg-background p-6">
        <h2 className="text-lg font-semibold mb-4">Invoice Status Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-sm text-muted-foreground">
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium text-right">Count</th>
                <th className="pb-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {['draft', 'sent', 'paid', 'overdue', 'voided'].map((status) => {
                const filtered = invList.filter((inv) => inv.status === status);
                const count = filtered.length;
                const amount = filtered.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
                return (
                  <tr key={status} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                          status === 'paid'
                            ? 'bg-green-100 text-green-800'
                            : status === 'voided'
                              ? 'bg-red-100 text-red-800'
                              : status === 'sent'
                                ? 'bg-blue-100 text-blue-800'
                                : status === 'overdue'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="py-4 text-right text-sm">{count}</td>
                    <td className="py-4 text-right text-sm">{formatMoney(amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
