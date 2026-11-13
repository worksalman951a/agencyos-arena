import { describe, expect, it } from 'vitest';
import { calculateProjectFinancialSummary } from '@/lib/finance/project-financial-summary';

const date = new Date('2026-01-15T12:00:00.000Z');

function invoice(
  input: Partial<Parameters<typeof calculateProjectFinancialSummary>[0]['invoices'][number]> & {
    id: string;
  }
) {
  return {
    number: input.id,
    status: 'sent',
    currency: 'USD',
    subtotal: '0.00',
    total: '0.00',
    dueDate: null,
    createdAt: date,
    payments: [],
    ...input,
  };
}

function financialInput(
  overrides: Partial<Parameters<typeof calculateProjectFinancialSummary>[0]> = {}
): Parameters<typeof calculateProjectFinancialSummary>[0] {
  return {
    project: {
      id: 'project-1',
      name: 'Project One',
      status: 'active',
      deletedAt: null,
      budget: '1000.00',
    },
    projectCurrency: 'USD',
    invoices: [],
    expenses: [],
    changeOrders: [],
    timeEntries: [],
    ...overrides,
  };
}

describe('project financial calculations', () => {
  it('adds only approved change orders and distinguishes invoiced, collected and outstanding amounts', () => {
    const summary = calculateProjectFinancialSummary(
      financialInput({
        invoices: [
          invoice({
            id: 'INV-1',
            status: 'sent',
            subtotal: '500.00',
            total: '550.00',
            payments: [{ amount: '200.00' }],
          }),
          invoice({
            id: 'INV-2',
            status: 'paid',
            subtotal: '200.00',
            total: '220.00',
            payments: [{ amount: '100.00' }, { amount: '120.00' }],
          }),
          invoice({ id: 'DRAFT', status: 'draft', subtotal: '999.00', total: '999.00' }),
          invoice({ id: 'VOID', status: 'voided', subtotal: '999.00', total: '999.00' }),
          invoice({ id: 'CANCELLED', status: 'cancelled', subtotal: '999.00', total: '999.00' }),
        ],
        expenses: [],
        changeOrders: [
          {
            id: 'approved',
            description: 'Approved work',
            status: 'approved',
            amount: '100.00',
            createdAt: date,
            billedInvoiceItem: null,
          },
          {
            id: 'pending',
            description: 'Pending work',
            status: 'pending',
            amount: '500.00',
            createdAt: date,
            billedInvoiceItem: null,
          },
        ],
      })
    );

    expect(summary.budget).toEqual({
      original: '1000.00',
      approvedChangeOrders: '100.00',
      revised: '1100.00',
      utilizationPercent: '63.6',
    });
    expect(summary.invoices.byCurrency).toEqual([
      {
        currency: 'USD',
        invoicedIncludingTax: '770.00',
        invoicedRevenueExcludingTax: '700.00',
        paymentsReceived: '420.00',
        outstandingBalance: '350.00',
      },
    ]);
    expect(summary.invoices.activeCount).toBe(2);
    expect(summary.changeOrders.unbilledApprovedAmount).toBe('100.00');
    // Invoice source totals remain the invoiced values; no source is added twice.
    expect(summary.comparisonInProjectCurrency.invoicedRevenueExcludingTax).toBe('700.00');
  });

  it('keeps currencies separate and clamps balance per invoice, not across invoices', () => {
    const summary = calculateProjectFinancialSummary(
      financialInput({
        invoices: [
          invoice({
            id: 'USD-OVERPAID',
            currency: 'USD',
            total: '100.00',
            subtotal: '100.00',
            payments: [{ amount: '110.00' }],
          }),
          invoice({
            id: 'EUR-OPEN',
            currency: 'EUR',
            total: '50.00',
            subtotal: '50.00',
            payments: [{ amount: '10.00' }],
          }),
        ],
      })
    );

    expect(summary.invoices.byCurrency).toEqual([
      {
        currency: 'EUR',
        invoicedIncludingTax: '50.00',
        invoicedRevenueExcludingTax: '50.00',
        paymentsReceived: '10.00',
        outstandingBalance: '40.00',
      },
      {
        currency: 'USD',
        invoicedIncludingTax: '100.00',
        invoicedRevenueExcludingTax: '100.00',
        paymentsReceived: '110.00',
        outstandingBalance: '0.00',
      },
    ]);
    expect(summary.comparisonInProjectCurrency.invoicedRevenueExcludingTax).toBe('100.00');
  });

  it('counts direct expenses once and leaves linked expenses and change orders out of unbilled totals', () => {
    const linked = { invoice: { status: 'sent', deletedAt: null } };
    const summary = calculateProjectFinancialSummary(
      financialInput({
        expenses: [
          {
            id: 'billed-expense',
            category: 'Travel',
            amount: '19.99',
            expenseDate: date,
            billable: true,
            billedInvoiceItem: linked,
          },
          {
            id: 'unbilled-expense',
            category: 'Materials',
            amount: '0.10',
            expenseDate: date,
            billable: true,
            billedInvoiceItem: null,
          },
          {
            id: 'nonbillable',
            category: 'Internal',
            amount: '0.20',
            expenseDate: date,
            billable: false,
            billedInvoiceItem: null,
          },
        ],
        changeOrders: [
          {
            id: 'linked-order',
            description: 'Billed change',
            status: 'approved',
            amount: '25.00',
            createdAt: date,
            billedInvoiceItem: linked,
          },
          {
            id: 'open-order',
            description: 'Not yet invoiced',
            status: 'approved',
            amount: '5.00',
            createdAt: date,
            billedInvoiceItem: null,
          },
        ],
      })
    );

    expect(summary.expenses.recordedDirectCosts).toBe('20.29');
    expect(summary.expenses.unbilledBillable).toBe('0.10');
    expect(summary.expenses.unbilledCount).toBe(1);
    expect(summary.expenses.linkedToInvoicesCount).toBe(1);
    expect(summary.changeOrders.approvedAmount).toBe('30.00');
    expect(summary.changeOrders.unbilledApprovedAmount).toBe('5.00');
    expect(summary.changeOrders.unbilledApprovedCount).toBe(1);
    expect(summary.comparisonInProjectCurrency.revenueLessRecordedDirectCosts).toBe('-20.29');
  });

  it('treats source links to voided or deleted invoices as unbilled', () => {
    const summary = calculateProjectFinancialSummary(
      financialInput({
        expenses: [
          {
            id: 'void-linked-expense',
            category: 'Travel',
            amount: '12.00',
            expenseDate: date,
            billable: true,
            billedInvoiceItem: { invoice: { status: 'voided', deletedAt: null } },
          },
        ],
        changeOrders: [
          {
            id: 'deleted-invoice-change-order',
            description: 'Voided source',
            status: 'approved',
            amount: '40.00',
            createdAt: date,
            billedInvoiceItem: { invoice: { status: 'sent', deletedAt: date } },
          },
        ],
      })
    );

    expect(summary.expenses.unbilledBillable).toBe('12.00');
    expect(summary.expenses.unbilledCount).toBe(1);
    expect(summary.expenses.linkedToInvoicesCount).toBe(0);
    expect(summary.expenses.details[0].billed).toBe(false);
    expect(summary.changeOrders.unbilledApprovedAmount).toBe('40.00');
    expect(summary.changeOrders.unbilledApprovedCount).toBe(1);
  });

  it('estimates only rated billable time, preserves currencies and never treats it as revenue or cost', () => {
    const summary = calculateProjectFinancialSummary(
      financialInput({
        timeEntries: [
          { id: 'usd', hours: '1.2500', hourlyRate: '80.00', billable: true, currency: 'USD' },
          { id: 'eur', hours: '2.0000', hourlyRate: '40.00', billable: true, currency: 'EUR' },
          { id: 'unrated', hours: '3.0000', hourlyRate: null, billable: true, currency: null },
          {
            id: 'nonbillable',
            hours: '10.0000',
            hourlyRate: '999.00',
            billable: false,
            currency: 'USD',
          },
          {
            id: 'bad-currency',
            hours: '1.0000',
            hourlyRate: '10.00',
            billable: true,
            currency: '???',
          },
        ],
      })
    );

    expect(summary.billableTime.estimatedValueByCurrency).toEqual([
      { currency: 'EUR', amount: '80.00', entryCount: 1 },
      { currency: 'USD', amount: '100.00', entryCount: 1 },
    ]);
    expect(summary.billableTime.ratedEntryCount).toBe(2);
    expect(summary.billableTime.unratedEntryCount).toBe(1);
    expect(summary.billableTime.excludedInvalidCurrencyCount).toBe(1);
    expect(summary.invoices.byCurrency).toEqual([]);
    expect(summary.expenses.recordedDirectCosts).toBe('0.00');
    expect(summary.comparisonInProjectCurrency.revenueLessRecordedDirectCosts).toBe('0.00');
  });

  it('uses exact decimal aggregation, excludes unknown currencies and leaves missing budget/profit unavailable', () => {
    const summary = calculateProjectFinancialSummary(
      financialInput({
        project: {
          id: 'project-1',
          name: 'No budget',
          status: 'archived',
          deletedAt: date,
          budget: null,
        },
        invoices: [
          invoice({ id: 'a', subtotal: '0.10', total: '0.10' }),
          invoice({ id: 'b', subtotal: '0.20', total: '0.20' }),
          invoice({ id: 'unknown', currency: 'ZZZ', subtotal: '500', total: '500' }),
        ],
      })
    );

    expect(summary.invoices.byCurrency[0]).toMatchObject({
      currency: 'USD',
      invoicedIncludingTax: '0.30',
      invoicedRevenueExcludingTax: '0.30',
    });
    expect(summary.invoices.excludedInvalidCurrencyCount).toBe(1);
    expect(summary.budget.revised).toBeNull();
    expect(summary.budget.utilizationPercent).toBeNull();
    expect(summary.project).toMatchObject({ status: 'archived', isDeleted: true });
    expect(summary.comparisonInProjectCurrency.netProfitability).toBeNull();
    expect(summary.comparisonInProjectCurrency.netProfitabilityUnavailableReason).toContain(
      'labor cost'
    );
  });

  it('returns explicit zero-record totals without inventing a budget', () => {
    const summary = calculateProjectFinancialSummary(
      financialInput({
        project: { id: 'p', name: 'Empty', status: 'active', deletedAt: null, budget: null },
      })
    );
    expect(summary.invoices.byCurrency).toEqual([]);
    expect(summary.expenses.recordedDirectCosts).toBe('0.00');
    expect(summary.changeOrders.approvedAmount).toBe('0.00');
    expect(summary.billableTime.estimatedValueByCurrency).toEqual([]);
    expect(summary.budget.original).toBeNull();
    expect(summary.budget.revised).toBeNull();
  });
});
