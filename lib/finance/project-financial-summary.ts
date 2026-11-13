import { computeBillableAmountMinor } from '@/lib/projects/time-entry-billing';
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from '@/lib/currencies';

type DecimalLike = string | number | { toString(): string } | null | undefined;

export type SourceBillingStatus = 'available' | 'reserved' | 'billed' | 'locked';

type BillingStatusTotals = Record<SourceBillingStatus, { amount: string; count: number }>;

export interface ProjectFinancialSummaryInput {
  project: {
    id: string;
    name: string;
    status: string;
    deletedAt: Date | null;
    budget: DecimalLike;
  };
  projectCurrency: string;
  invoices: Array<{
    id: string;
    number: string;
    status: string;
    currency: string;
    subtotal: DecimalLike;
    total: DecimalLike;
    dueDate: Date | null;
    createdAt: Date;
    payments: Array<{ amount: DecimalLike }>;
  }>;
  expenses: Array<{
    id: string;
    category: string;
    amount: DecimalLike;
    expenseDate: Date;
    billable: boolean;
    billedInvoiceItem: { invoice: { status: string; deletedAt: Date | null } } | null;
  }>;
  changeOrders: Array<{
    id: string;
    description: string;
    amount: DecimalLike;
    status: string;
    createdAt: Date;
    billedInvoiceItem: { invoice: { status: string; deletedAt: Date | null } } | null;
  }>;
  timeEntries: Array<{
    id: string;
    hours: DecimalLike;
    billable: boolean;
    hourlyRate: DecimalLike;
    currency: string | null;
  }>;
}

export interface ProjectFinancialCurrencyTotals {
  currency: string;
  invoicedIncludingTax: string;
  invoicedRevenueExcludingTax: string;
  paymentsReceived: string;
  outstandingBalance: string;
}

export interface ProjectFinancialSummary {
  project: {
    id: string;
    name: string;
    status: string;
    isDeleted: boolean;
  };
  projectCurrency: string;
  budget: {
    original: string | null;
    approvedChangeOrders: string;
    revised: string | null;
    utilizationPercent: string | null;
  };
  invoices: {
    activeCount: number;
    excludedInvalidCurrencyCount: number;
    byCurrency: ProjectFinancialCurrencyTotals[];
    details: Array<{
      id: string;
      number: string;
      status: string;
      currency: string;
      invoicedIncludingTax: string;
      invoicedRevenueExcludingTax: string;
      paymentsReceived: string;
      outstandingBalance: string;
      dueDate: string | null;
      createdAt: string;
    }>;
  };
  expenses: {
    recordedDirectCosts: string;
    billable: string;
    nonBillable: string;
    /** Available billable expenses only: no InvoiceItem source link exists. */
    unbilledBillable: string;
    unbilledCount: number;
    linkedToInvoicesCount: number;
    billingStatusTotals: BillingStatusTotals;
    details: Array<{
      id: string;
      category: string;
      amount: string;
      expenseDate: string;
      billable: boolean;
      billed: boolean;
      billingStatus: SourceBillingStatus;
    }>;
  };
  changeOrders: {
    approvedAmount: string;
    /** Available approved change orders only: no InvoiceItem source link exists. */
    unbilledApprovedAmount: string;
    unbilledApprovedCount: number;
    billingStatusTotals: BillingStatusTotals;
    details: Array<{
      id: string;
      description: string;
      amount: string;
      createdAt: string;
      billingStatus: SourceBillingStatus;
    }>;
  };
  billableTime: {
    estimatedValueByCurrency: Array<{ currency: string; amount: string; entryCount: number }>;
    ratedEntryCount: number;
    unratedEntryCount: number;
    excludedInvalidCurrencyCount: number;
  };
  comparisonInProjectCurrency: {
    invoicedRevenueExcludingTax: string;
    recordedDirectCosts: string;
    revenueLessRecordedDirectCosts: string;
    partialMarginPercent: string | null;
    netProfitability: null;
    netProfitabilityUnavailableReason: string;
  };
}

function rawDecimal(value: DecimalLike): string {
  if (value === null || value === undefined) return '0';
  return typeof value === 'number' ? value.toString() : value.toString().trim();
}

/** Convert a decimal amount to integer cents without binary floating-point math. */
function toMinorUnits(value: DecimalLike): bigint {
  const raw = rawDecimal(value);
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new Error(`Invalid stored monetary amount: ${raw}`);

  const [, negative, whole, fraction = ''] = match;
  const cents = BigInt((fraction + '00').slice(0, 2));
  let amount = BigInt(whole) * BigInt(100) + cents;
  if ((fraction[2] ?? '0') >= '5') amount += BigInt(1);
  return negative ? -amount : amount;
}

function formatMinorUnits(value: bigint): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, '0')}`;
}

function formatPercentTenths(numerator: bigint, denominator: bigint): string | null {
  if (denominator === BigInt(0)) return null;
  const sign = numerator < BigInt(0) ? '-' : '';
  const absolute = numerator < BigInt(0) ? -numerator : numerator;
  const tenths = (absolute * BigInt(1000) + denominator / BigInt(2)) / denominator;
  return `${sign}${tenths / BigInt(10)}.${tenths % BigInt(10)}`;
}

function normalizeCurrencyOrNull(value: string | null | undefined): string | null {
  return value ? normalizeCurrencyCode(value) : null;
}

type InvoiceSourceLink = { invoice: { status: string; deletedAt: Date | null } } | null;

/**
 * Source links are durable reservations because InvoiceItem source ids are unique.
 * A draft reserves the source; issued invoices have billed it; voided, cancelled,
 * deleted, or otherwise non-billable linked invoices leave it locked for reversal.
 */
function classifySourceBillingStatus(source: InvoiceSourceLink): SourceBillingStatus {
  if (source === null) return 'available';
  if (source.invoice.deletedAt !== null) return 'locked';
  if (source.invoice.status === 'draft') return 'reserved';
  if (['sent', 'overdue', 'paid'].includes(source.invoice.status)) return 'billed';
  return 'locked';
}

const BILLING_STATUSES: SourceBillingStatus[] = ['available', 'reserved', 'billed', 'locked'];

function emptyBillingStatusTotals() {
  return {
    available: { amount: BigInt(0), count: 0 },
    reserved: { amount: BigInt(0), count: 0 },
    billed: { amount: BigInt(0), count: 0 },
    locked: { amount: BigInt(0), count: 0 },
  } satisfies Record<SourceBillingStatus, { amount: bigint; count: number }>;
}

function formatBillingStatusTotals(
  totals: Record<SourceBillingStatus, { amount: bigint; count: number }>
): BillingStatusTotals {
  return Object.fromEntries(
    BILLING_STATUSES.map((status) => [
      status,
      { amount: formatMinorUnits(totals[status].amount), count: totals[status].count },
    ])
  ) as BillingStatusTotals;
}

interface MutableCurrencyTotals {
  invoicedIncludingTax: bigint;
  invoicedRevenueExcludingTax: bigint;
  paymentsReceived: bigint;
  outstandingBalance: bigint;
}

export function calculateProjectFinancialSummary(
  input: ProjectFinancialSummaryInput
): ProjectFinancialSummary {
  const projectCurrency = normalizeCurrencyCode(input.projectCurrency) ?? DEFAULT_CURRENCY;
  const currencyTotals = new Map<string, MutableCurrencyTotals>();
  const getCurrencyTotals = (currency: string) => {
    const existing = currencyTotals.get(currency);
    if (existing) return existing;
    const created: MutableCurrencyTotals = {
      invoicedIncludingTax: BigInt(0),
      invoicedRevenueExcludingTax: BigInt(0),
      paymentsReceived: BigInt(0),
      outstandingBalance: BigInt(0),
    };
    currencyTotals.set(currency, created);
    return created;
  };

  let excludedInvalidInvoiceCurrencyCount = 0;
  const invoiceDetails: ProjectFinancialSummary['invoices']['details'] = [];
  const invoiceRevenueInProjectCurrency = BigInt(0);
  let projectCurrencyRevenue = invoiceRevenueInProjectCurrency;

  for (const invoice of input.invoices) {
    // Only issued, non-voided invoices are passed by the service. Keep the
    // whitelist here as a second guard for pure callers/tests.
    if (!['sent', 'overdue', 'paid'].includes(invoice.status)) continue;
    const currency = normalizeCurrencyOrNull(invoice.currency);
    if (!currency) {
      excludedInvalidInvoiceCurrencyCount += 1;
      continue;
    }

    const gross = toMinorUnits(invoice.total);
    const revenue = toMinorUnits(invoice.subtotal);
    const payments = invoice.payments.reduce(
      (sum, payment) => sum + toMinorUnits(payment.amount),
      BigInt(0)
    );
    const balance = gross > payments ? gross - payments : BigInt(0);
    const bucket = getCurrencyTotals(currency);
    bucket.invoicedIncludingTax += gross;
    bucket.invoicedRevenueExcludingTax += revenue;
    bucket.paymentsReceived += payments;
    bucket.outstandingBalance += balance;
    if (currency === projectCurrency) projectCurrencyRevenue += revenue;

    invoiceDetails.push({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      currency,
      invoicedIncludingTax: formatMinorUnits(gross),
      invoicedRevenueExcludingTax: formatMinorUnits(revenue),
      paymentsReceived: formatMinorUnits(payments),
      outstandingBalance: formatMinorUnits(balance),
      dueDate: invoice.dueDate?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
    });
  }

  const expenseDetails = input.expenses.map((expense) => {
    const billingStatus = classifySourceBillingStatus(expense.billedInvoiceItem);
    return {
      id: expense.id,
      category: expense.category,
      amount: formatMinorUnits(toMinorUnits(expense.amount)),
      expenseDate: expense.expenseDate.toISOString(),
      billable: expense.billable,
      billed: billingStatus === 'billed',
      billingStatus,
    };
  });
  const expenses = input.expenses.reduce(
    (totals, expense) => {
      const amount = toMinorUnits(expense.amount);
      const billingStatus = classifySourceBillingStatus(expense.billedInvoiceItem);
      totals.recorded += amount;
      if (expense.billable) totals.billable += amount;
      else totals.nonBillable += amount;

      if (billingStatus !== 'available') totals.linkedCount += 1;
      // Only billable and truly unlinked source expenses are available to bill.
      if (expense.billable) {
        totals.billingStatusTotals[billingStatus].amount += amount;
        totals.billingStatusTotals[billingStatus].count += 1;
      }
      if (expense.billable && billingStatus === 'available') {
        totals.unbilled += amount;
        totals.unbilledCount += 1;
      }
      return totals;
    },
    {
      recorded: BigInt(0),
      billable: BigInt(0),
      nonBillable: BigInt(0),
      unbilled: BigInt(0),
      unbilledCount: 0,
      linkedCount: 0,
      billingStatusTotals: emptyBillingStatusTotals(),
    }
  );

  let approvedChangeOrderTotal = BigInt(0);
  let unbilledChangeOrderTotal = BigInt(0);
  let unbilledApprovedCount = 0;
  const changeOrderBillingStatusTotals = emptyBillingStatusTotals();
  const approvedChangeOrderDetails: ProjectFinancialSummary['changeOrders']['details'] = [];
  for (const changeOrder of input.changeOrders) {
    if (changeOrder.status !== 'approved') continue;
    const amount = toMinorUnits(changeOrder.amount);
    const billingStatus = classifySourceBillingStatus(changeOrder.billedInvoiceItem);
    approvedChangeOrderTotal += amount;
    changeOrderBillingStatusTotals[billingStatus].amount += amount;
    changeOrderBillingStatusTotals[billingStatus].count += 1;
    if (billingStatus === 'available') {
      unbilledChangeOrderTotal += amount;
      unbilledApprovedCount += 1;
    }
    approvedChangeOrderDetails.push({
      id: changeOrder.id,
      description: changeOrder.description,
      amount: formatMinorUnits(amount),
      createdAt: changeOrder.createdAt.toISOString(),
      billingStatus,
    });
  }

  const billableTimeValues = new Map<string, { amount: bigint; entryCount: number }>();
  let ratedTimeEntryCount = 0;
  let unratedTimeEntryCount = 0;
  let excludedInvalidTimeCurrencyCount = 0;
  for (const entry of input.timeEntries) {
    if (!entry.billable) continue;
    const amountMinor = computeBillableAmountMinor(entry.hours ?? '0', entry.hourlyRate, true);
    if (amountMinor === null) {
      unratedTimeEntryCount += 1;
      continue;
    }
    const currency =
      entry.currency === null ? projectCurrency : normalizeCurrencyOrNull(entry.currency);
    if (!currency) {
      excludedInvalidTimeCurrencyCount += 1;
      continue;
    }
    const amount = BigInt(amountMinor);
    const bucket = billableTimeValues.get(currency) ?? { amount: BigInt(0), entryCount: 0 };
    bucket.amount += amount;
    bucket.entryCount += 1;
    billableTimeValues.set(currency, bucket);
    ratedTimeEntryCount += 1;
  }

  const originalBudget =
    input.project.budget === null || input.project.budget === undefined
      ? null
      : toMinorUnits(input.project.budget);
  const revisedBudget = originalBudget === null ? null : originalBudget + approvedChangeOrderTotal;
  const budgetUtilizationPercent =
    revisedBudget === null || revisedBudget <= BigInt(0)
      ? null
      : formatPercentTenths(projectCurrencyRevenue, revisedBudget);
  const projectCurrencyExpenses = expenses.recorded;
  const partialMargin = projectCurrencyRevenue - projectCurrencyExpenses;

  const byCurrency = [...currencyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, totals]) => ({
      currency,
      invoicedIncludingTax: formatMinorUnits(totals.invoicedIncludingTax),
      invoicedRevenueExcludingTax: formatMinorUnits(totals.invoicedRevenueExcludingTax),
      paymentsReceived: formatMinorUnits(totals.paymentsReceived),
      outstandingBalance: formatMinorUnits(totals.outstandingBalance),
    }));

  return {
    project: {
      id: input.project.id,
      name: input.project.name,
      status: input.project.status,
      isDeleted: input.project.deletedAt !== null,
    },
    projectCurrency,
    budget: {
      original: originalBudget === null ? null : formatMinorUnits(originalBudget),
      approvedChangeOrders: formatMinorUnits(approvedChangeOrderTotal),
      revised: revisedBudget === null ? null : formatMinorUnits(revisedBudget),
      utilizationPercent: budgetUtilizationPercent,
    },
    invoices: {
      activeCount: invoiceDetails.length,
      excludedInvalidCurrencyCount: excludedInvalidInvoiceCurrencyCount,
      byCurrency,
      details: invoiceDetails.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    },
    expenses: {
      recordedDirectCosts: formatMinorUnits(expenses.recorded),
      billable: formatMinorUnits(expenses.billable),
      nonBillable: formatMinorUnits(expenses.nonBillable),
      unbilledBillable: formatMinorUnits(expenses.unbilled),
      unbilledCount: expenses.unbilledCount,
      linkedToInvoicesCount: expenses.linkedCount,
      billingStatusTotals: formatBillingStatusTotals(expenses.billingStatusTotals),
      details: expenseDetails.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)),
    },
    changeOrders: {
      approvedAmount: formatMinorUnits(approvedChangeOrderTotal),
      unbilledApprovedAmount: formatMinorUnits(unbilledChangeOrderTotal),
      unbilledApprovedCount,
      billingStatusTotals: formatBillingStatusTotals(changeOrderBillingStatusTotals),
      details: approvedChangeOrderDetails,
    },
    billableTime: {
      estimatedValueByCurrency: [...billableTimeValues.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, bucket]) => ({
          currency,
          amount: formatMinorUnits(bucket.amount),
          entryCount: bucket.entryCount,
        })),
      ratedEntryCount: ratedTimeEntryCount,
      unratedEntryCount: unratedTimeEntryCount,
      excludedInvalidCurrencyCount: excludedInvalidTimeCurrencyCount,
    },
    comparisonInProjectCurrency: {
      invoicedRevenueExcludingTax: formatMinorUnits(projectCurrencyRevenue),
      recordedDirectCosts: formatMinorUnits(projectCurrencyExpenses),
      revenueLessRecordedDirectCosts: formatMinorUnits(partialMargin),
      partialMarginPercent: formatPercentTenths(partialMargin, projectCurrencyRevenue),
      netProfitability: null,
      netProfitabilityUnavailableReason:
        'Employee labor cost and overhead data are not recorded, so net project profitability cannot be calculated.',
    },
  };
}
