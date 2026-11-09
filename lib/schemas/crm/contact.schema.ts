import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for Contact CRUD operations.
 * All schemas enforce server-side validation on every request.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

const baseContactSchema = z.object({
  accountId: z.string().cuid().optional().nullable(),
  firstName: z.string().min(1, 'First name is required').max(100).optional().nullable(),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email address').optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  status: z.string().min(1).max(50).default('active'),
  source: z.string().max(100).optional().nullable(),
});

export const contactCreateSchema = baseContactSchema
  .strict()
  .refine(
    (data) => data.firstName || data.lastName || data.email || data.phone,
    'At least one contact identifier (name, email, or phone) is required'
  );

export const contactUpdateSchema = baseContactSchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.accountId !== undefined ||
      data.firstName !== undefined ||
      data.lastName !== undefined ||
      data.email !== undefined ||
      data.phone !== undefined ||
      data.status !== undefined ||
      data.source !== undefined,
    'At least one field must be provided for update'
  );

export const contactQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  accountId: z.string().cuid().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['firstName', 'lastName', 'email', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: includeDeletedQueryParam,
});

export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
export type ContactQueryInput = z.infer<typeof contactQuerySchema>;
