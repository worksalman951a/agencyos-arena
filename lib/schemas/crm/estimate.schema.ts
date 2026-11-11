import { z } from 'zod';

/**
 * Zod validation schemas for Estimate CRUD operations.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

export const ESTIMATE_MUTABLE_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
] as const;

export const estimateCreateSchema = z.object({
  clientId: z.string().cuid('Valid client ID is required'),
  number: z.string().min(1, 'Estimate number is required').max(50),
  status: z.enum(ESTIMATE_MUTABLE_STATUSES).default('draft'),
  total: z.string().refine(
    (val) => {
      const n = Number(val);
      return !isNaN(n) && n >= 0;
    },
    { message: 'Total must be a non-negative number' }
  ),
  currency: z.string().min(1).max(10).default('USD'),
  validUntil: z.string().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const estimateUpdateSchema = z
  .object({
    clientId: z.string().cuid('Valid client ID is required').optional(),
    number: z.string().min(1, 'Estimate number is required').max(50).optional(),
    status: z.enum(ESTIMATE_MUTABLE_STATUSES).optional(),
    total: z
      .string()
      .refine(
        (val) => {
          const n = Number(val);
          return !isNaN(n) && n >= 0;
        },
        { message: 'Total must be a non-negative number' }
      )
      .optional(),
    currency: z.string().min(1).max(10).optional(),
    validUntil: z.string().optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
  })
  .strict()
  .refine(
    (data) =>
      data.clientId !== undefined ||
      data.number !== undefined ||
      data.status !== undefined ||
      data.total !== undefined ||
      data.currency !== undefined ||
      data.validUntil !== undefined ||
      data.notes !== undefined,
    'At least one field must be provided for update'
  );

export type EstimateCreateInput = z.infer<typeof estimateCreateSchema>;
export type EstimateUpdateInput = z.infer<typeof estimateUpdateSchema>;

/**
 * The invoice number is assigned by the organization's document allocator, never
 * by the client: a caller-supplied `invoiceNumber` is stripped by this schema.
 */
export const estimateConvertSchema = z.object({
  invoiceTitle: z.string().min(1, 'Invoice title is required').max(200),
  dueDate: z.string().optional().nullable(),
});

export type EstimateConvertInput = z.infer<typeof estimateConvertSchema>;
