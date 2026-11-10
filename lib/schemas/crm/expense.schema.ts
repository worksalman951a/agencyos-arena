import { z } from 'zod';

/**
 * Zod validation schemas for ExpenseItem CRUD operations.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

export const expenseCreateSchema = z.object({
  projectId: z.string().cuid().optional().nullable(),
  category: z.string().min(1, 'Category is required').max(100),
  amount: z.string().refine(
    (val) => {
      const n = Number(val);
      return !isNaN(n) && n > 0;
    },
    { message: 'Amount must be a positive number' }
  ),
  expenseDate: z.string().datetime('Valid date is required'),
  receiptUrl: z.string().url().optional().nullable(),
  billable: z.boolean().default(false),
});

export const expenseUpdateSchema = expenseCreateSchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.projectId !== undefined ||
      data.category !== undefined ||
      data.amount !== undefined ||
      data.expenseDate !== undefined ||
      data.receiptUrl !== undefined ||
      data.billable !== undefined,
    'At least one field must be provided for update'
  );

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;

/**
 * Query parameters for the expense list.
 *
 * Deliberately limited to what the schema can answer: a free-text search over
 * the category, an exact category filter, the billable flag, an `expenseDate`
 * range, sorting and pagination. There is no currency filter because
 * `ExpenseItem` has no currency column (expenses are reported in the workspace
 * currency).
 */
export const EXPENSE_SORT_OPTIONS = [
  'date_desc',
  'date_asc',
  'amount_desc',
  'amount_asc',
  'category_asc',
] as const;

export const expenseListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  billable: z.enum(['true', 'false']).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  sort: z.enum(EXPENSE_SORT_OPTIONS).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type ExpenseListQueryInput = z.infer<typeof expenseListQuerySchema>;
