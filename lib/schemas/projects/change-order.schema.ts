import { z } from 'zod';

const validAmount = z.string().refine(
  (val) => {
    const trimmed = val.trim();
    if (!trimmed) return false;
    const n = Number(trimmed);
    return !Number.isNaN(n) && Number.isFinite(n);
  },
  { message: 'Amount must be a valid number' }
);

const userIdString = z.string().trim().min(1, 'Valid user ID is required').max(128);

export const changeOrderCreateSchema = z
  .object({
    projectId: z.string().cuid('Valid project ID is required'),
    description: z.string().trim().min(1, 'Description is required').max(5000),
    amount: validAmount,
    status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
    approvedBy: userIdString.optional().nullable(),
  })
  .strict();

export const changeOrderUpdateSchema = z
  .object({
    description: z.string().trim().min(1, 'Description is required').max(5000).optional(),
    amount: validAmount.optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    approvedBy: userIdString.optional().nullable(),
  })
  .partial()
  .strict()
  .refine(
    (data) =>
      data.description !== undefined ||
      data.amount !== undefined ||
      data.status !== undefined ||
      data.approvedBy !== undefined,
    'At least one field must be provided for update'
  );

export type ChangeOrderCreateInput = z.infer<typeof changeOrderCreateSchema>;
export type ChangeOrderUpdateInput = z.infer<typeof changeOrderUpdateSchema>;
