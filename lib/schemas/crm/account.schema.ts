import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for AgencyAccount CRUD operations.
 * All schemas enforce server-side validation on every request.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

const baseAccountSchema = z.object({
  name: z.string().min(1, 'Account name is required').max(200),
  website: z.string().url('Invalid website URL').optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  status: z.string().min(1).max(50).default('active'),
});

export const accountCreateSchema = baseAccountSchema.strict();

export const accountUpdateSchema = baseAccountSchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.website !== undefined ||
      data.address !== undefined ||
      data.status !== undefined,
    'At least one field must be provided for update'
  );

export const accountQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['name', 'status', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: includeDeletedQueryParam,
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
export type AccountQueryInput = z.infer<typeof accountQuerySchema>;
