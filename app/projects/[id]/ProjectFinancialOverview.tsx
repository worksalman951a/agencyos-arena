import type { ReactNode } from 'react';

import { formatCurrencyAmount } from '@/lib/currencies';
import type {
  ProjectFinancialCurrencyTotals,
  ProjectFinancialSummary,
} from '@/lib/finance/project-financial-summary';

function CurrencyValues({
  rows,
  value,
  empty = '—',
}: {
  rows: ProjectFinancialCurrencyTotals[];
  value: keyof Omit<ProjectFinancialCurrencyTotals, 'currency'>;
  empty?: string;
}) {
  return rows.length ? (
    <ul className="space-y-1 text-right">
      {rows.map((row) => (
        <li key={row.currency}>
          <span className="font-semibold">
            {formatCurrencyAmount(row[value] as string, row.currency)}
          </span>
          <span className="sr-only"> {row.currency}</span>
        </li>
      ))}
    </ul>
  ) : (
    <span className="font-semibold text-muted-foreground">{empty}</span>
  );
}

function SummaryCard({
  label,
  children,
  description,
}: {
  label: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-3">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="mt-2 text-sm">{children}</div>
      {description ? <p className="mt-2 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function ProjectFinancialOverview({ summary }: { summary: ProjectFinancialSummary }) {
  const projectCurrency = summary.projectCurrency;
  const invoiceTotals = summary.invoices.byCurrency;
  const estimatedTime = summary.billableTime.estimatedValueByCurrency;

  return (
    <section
      aria-labelledby="project-financial-overview-title"
      className="rounded-lg border bg-muted/20 p-4 sm:p-5 space-y-4"
      data-testid="project-financial-overview"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="project-financial-overview-title" className="text-lg font-semibold">
            Financial Overview
          </h2>
          <p className="text-xs text-muted-foreground">
            Budget, invoicing and recorded costs are reported in their source currencies; no
            currency conversion is applied.
          </p>
        </div>
        {(summary.project.status === 'archived' || summary.project.isDeleted) && (
          <p className="text-xs text-muted-foreground" role="note">
            {summary.project.isDeleted
              ? 'Deleted project — historical financial data is read-only.'
              : 'Archived project — showing historical financial data.'}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Original project budget"
          description={`Project budgets use the workspace currency (${projectCurrency}).`}
        >
          {summary.budget.original === null ? (
            <span className="font-semibold text-muted-foreground">Not set</span>
          ) : (
            <span className="font-semibold">
              {formatCurrencyAmount(summary.budget.original, projectCurrency)}
            </span>
          )}
        </SummaryCard>

        <SummaryCard
          label="Revised budget"
          description={`Original budget plus approved change orders, in ${projectCurrency}.`}
        >
          {summary.budget.revised === null ? (
            <span className="font-semibold text-muted-foreground">
              Unavailable — no original budget
            </span>
          ) : (
            <div className="space-y-1">
              <div className="font-semibold">
                {formatCurrencyAmount(summary.budget.revised, projectCurrency)}
              </div>
              <div className="text-xs text-muted-foreground">
                Change orders:{' '}
                {formatCurrencyAmount(summary.budget.approvedChangeOrders, projectCurrency)}
              </div>
            </div>
          )}
        </SummaryCard>

        <SummaryCard
          label="Invoiced (including tax)"
          description="Issued, paid and overdue invoices; drafts, voided and deleted invoices are excluded."
        >
          <CurrencyValues
            rows={invoiceTotals}
            value="invoicedIncludingTax"
            empty="No issued invoices"
          />
        </SummaryCard>

        <SummaryCard
          label="Payments received"
          description="Recorded payments against included invoices."
        >
          <CurrencyValues
            rows={invoiceTotals}
            value="paymentsReceived"
            empty="No payments recorded"
          />
        </SummaryCard>

        <SummaryCard
          label="Outstanding invoice balance"
          description="Invoice total less payments, floored at zero per invoice."
        >
          <CurrencyValues
            rows={invoiceTotals}
            value="outstandingBalance"
            empty="No outstanding invoices"
          />
        </SummaryCard>

        <SummaryCard
          label="Direct project expenses"
          description={`All recorded project expenses, in ${projectCurrency}; each expense is counted once.`}
        >
          <div className="font-semibold">
            {formatCurrencyAmount(summary.expenses.recordedDirectCosts, projectCurrency)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Billable {formatCurrencyAmount(summary.expenses.billable, projectCurrency)} ·
            Non-billable {formatCurrencyAmount(summary.expenses.nonBillable, projectCurrency)}
          </div>
        </SummaryCard>

        <SummaryCard
          label="Unbilled billable expenses"
          description="Billable expenses with no invoice-source line attached."
        >
          <div className="font-semibold">
            {formatCurrencyAmount(summary.expenses.unbilledBillable, projectCurrency)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {summary.expenses.unbilledCount} expense
            {summary.expenses.unbilledCount === 1 ? '' : 's'}
          </div>
        </SummaryCard>

        <SummaryCard
          label="Approved change orders not yet billed"
          description="Approved change orders without an invoice-source line; included in revised budget above."
        >
          <div className="font-semibold">
            {formatCurrencyAmount(summary.changeOrders.unbilledApprovedAmount, projectCurrency)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {summary.changeOrders.unbilledApprovedCount} change order
            {summary.changeOrders.unbilledApprovedCount === 1 ? '' : 's'}
          </div>
        </SummaryCard>

        <SummaryCard
          label="Budget invoiced"
          description="Net invoice subtotal (excluding tax) in the workspace currency divided by revised budget."
        >
          {summary.budget.utilizationPercent === null ? (
            <span className="font-semibold text-muted-foreground">Unavailable</span>
          ) : (
            <span className="font-semibold">{summary.budget.utilizationPercent}%</span>
          )}
        </SummaryCard>

        <SummaryCard
          label="Estimated billable time value"
          description="Rate × billable hours, rounded per entry. This is an estimate, not invoiced or collected revenue and not labor cost."
        >
          {estimatedTime.length ? (
            <ul className="space-y-1 text-right">
              {estimatedTime.map((row) => (
                <li key={row.currency} className="font-semibold">
                  {formatCurrencyAmount(row.amount, row.currency)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {row.entryCount} rated entr{row.entryCount === 1 ? 'y' : 'ies'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="font-semibold text-muted-foreground">No rated billable time</span>
          )}
          {summary.billableTime.unratedEntryCount > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {summary.billableTime.unratedEntryCount} billable entr
              {summary.billableTime.unratedEntryCount === 1 ? 'y has' : 'ies have'} no valid hourly
              rate; excluded from estimate.
            </p>
          )}
          {summary.billableTime.excludedInvalidCurrencyCount > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {summary.billableTime.excludedInvalidCurrencyCount} rated entr
              {summary.billableTime.excludedInvalidCurrencyCount === 1 ? 'y uses' : 'ies use'} an
              unsupported currency and{' '}
              {summary.billableTime.excludedInvalidCurrencyCount === 1 ? 'is' : 'are'} excluded.
            </p>
          )}
        </SummaryCard>

        <SummaryCard
          label="Revenue less recorded direct expenses"
          description={`Partial margin in ${projectCurrency}: invoice subtotal excluding tax less all project expenses. It excludes employee labor cost and overhead; it is not net profit.`}
        >
          <div className="font-semibold">
            {formatCurrencyAmount(
              summary.comparisonInProjectCurrency.revenueLessRecordedDirectCosts,
              projectCurrency
            )}
          </div>
          {summary.comparisonInProjectCurrency.partialMarginPercent !== null && (
            <div className="mt-1 text-xs text-muted-foreground">
              {summary.comparisonInProjectCurrency.partialMarginPercent}% of invoiced revenue
            </div>
          )}
        </SummaryCard>
      </div>

      {summary.invoices.excludedInvalidCurrencyCount > 0 && (
        <p className="text-xs text-amber-700" role="status">
          {summary.invoices.excludedInvalidCurrencyCount} issued invoice
          {summary.invoices.excludedInvalidCurrencyCount === 1 ? ' uses' : 's use'} an unsupported
          currency and {summary.invoices.excludedInvalidCurrencyCount === 1 ? 'is' : 'are'} excluded
          from currency totals.
        </p>
      )}

      <p className="text-xs text-muted-foreground" role="note">
        Net project profitability is unavailable because employee labor costs and overhead are not
        recorded. Payments are cash received, not revenue. Billable time value is an estimate only.
      </p>

      <details className="rounded-md border bg-background p-3">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Financial breakdown
        </summary>
        <div className="mt-4 space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Invoices by currency</h3>
            {summary.invoices.details.length === 0 ? (
              <p className="text-sm text-muted-foreground">No issued invoices are included.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <caption className="sr-only">
                    Issued invoices included in project financial totals
                  </caption>
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-3">
                        Invoice
                      </th>
                      <th scope="col" className="py-2 pr-3">
                        Status
                      </th>
                      <th scope="col" className="py-2 pr-3">
                        Currency
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right">
                        Invoiced incl. tax
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right">
                        Paid
                      </th>
                      <th scope="col" className="py-2 text-right">
                        Outstanding
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.invoices.details.map((invoice) => (
                      <tr key={invoice.id} className="border-b last:border-0">
                        <th scope="row" className="py-2 pr-3 font-medium">
                          {invoice.number}
                        </th>
                        <td className="py-2 pr-3 capitalize">{invoice.status}</td>
                        <td className="py-2 pr-3">{invoice.currency}</td>
                        <td className="py-2 pr-3 text-right">
                          {formatCurrencyAmount(invoice.invoicedIncludingTax, invoice.currency)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {formatCurrencyAmount(invoice.paymentsReceived, invoice.currency)}
                        </td>
                        <td className="py-2 text-right">
                          {formatCurrencyAmount(invoice.outstandingBalance, invoice.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Project expense records ({summary.expenses.details.length})
            </h3>
            {summary.expenses.details.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No expenses have been recorded for this project.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {summary.expenses.details.map((expense) => (
                  <li key={expense.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {expense.category}
                      {expense.billable ? ' · billable' : ' · non-billable'}
                      {expense.billed ? ' · linked to invoice' : ''}
                    </span>
                    <span className="font-medium">
                      {formatCurrencyAmount(expense.amount, projectCurrency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Approved change orders</h3>
            {summary.changeOrders.details.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unbilled approved change orders.</p>
            ) : (
              <ul className="divide-y text-sm">
                {summary.changeOrders.details.map((changeOrder) => (
                  <li key={changeOrder.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{changeOrder.description}</span>
                    <span className="font-medium">
                      {formatCurrencyAmount(changeOrder.amount, projectCurrency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {summary.invoices.byCurrency.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Totals remain separate by currency. No exchange-rate conversion or cross-currency
              addition is supported.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
