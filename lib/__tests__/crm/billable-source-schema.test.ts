import { describe, expect, it } from 'vitest';
import { invoiceBillableSourcesSchema } from '@/lib/schemas/crm/invoice.schema';
import { expenseCreateSchema } from '@/lib/schemas/crm/expense.schema';
import { changeOrderCreateSchema } from '@/lib/schemas/projects/change-order.schema';

const sourceId = 'cmproject0000000000000000a';

describe('invoice billable source selection schema', () => {
  it('requires an explicit source selection and defaults each selected tax rate to zero', () => {
    expect(invoiceBillableSourcesSchema.safeParse({}).success).toBe(false);
    expect(invoiceBillableSourcesSchema.parse({ expenses: [{ id: sourceId }] })).toEqual({
      expenses: [{ id: sourceId, taxRate: '0' }],
      changeOrders: [],
    });
  });

  it('rejects duplicate IDs, malformed source IDs, invalid rates and client-supplied organization authority', () => {
    expect(
      invoiceBillableSourcesSchema.safeParse({ expenses: [{ id: sourceId }, { id: sourceId }] })
        .success
    ).toBe(false);
    expect(
      invoiceBillableSourcesSchema.safeParse({ expenses: [{ id: 'not-a-cuid' }] }).success
    ).toBe(false);
    expect(
      invoiceBillableSourcesSchema.safeParse({ expenses: [{ id: sourceId, taxRate: '-1' }] })
        .success
    ).toBe(false);
    expect(
      invoiceBillableSourcesSchema.safeParse({
        expenses: [{ id: sourceId }],
        organizationId: 'org-other',
      }).success
    ).toBe(false);
  });

  it('accepts exact minor-unit source amounts while preserving unlinked expenses', () => {
    const expense = {
      category: 'Travel',
      amount: '10.25',
      expenseDate: new Date().toISOString(),
    };
    expect(expenseCreateSchema.safeParse(expense).success).toBe(true);
    expect(expenseCreateSchema.safeParse({ ...expense, amount: '10.257' }).success).toBe(false);
    expect(expenseCreateSchema.safeParse({ ...expense, amount: '-10.25' }).success).toBe(false);

    const changeOrder = { projectId: sourceId, description: 'Added scope', amount: '100.01' };
    expect(changeOrderCreateSchema.safeParse(changeOrder).success).toBe(true);
    expect(changeOrderCreateSchema.safeParse({ ...changeOrder, amount: '100.001' }).success).toBe(
      false
    );
  });
});
