import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for Lead CRUD operations.
 * All schemas enforce server-side validation on every request.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

const baseLeadSchema = z.object({
  contactId: z.string().cuid().optional().nullable(),
  accountId: z.string().cuid().optional().nullable(),
  source: z.string().min(1, 'Source is required').max(100),
  status: z.string().min(1, 'Status is required').max(50),
  priority: z.string().min(1, 'Priority is required').max(50),
  expectedValue: z.string().optional().nullable(),
  ownerId: z.string().cuid().optional().nullable(),
  pipelineId: z.string().cuid().optional().nullable(),
  stageId: z.string().cuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const leadCreateSchema = baseLeadSchema.strict();

export const leadUpdateSchema = baseLeadSchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.contactId !== undefined ||
      data.accountId !== undefined ||
      data.source !== undefined ||
      data.status !== undefined ||
      data.priority !== undefined ||
      data.expectedValue !== undefined ||
      data.ownerId !== undefined ||
      data.pipelineId !== undefined ||
      data.stageId !== undefined ||
      data.notes !== undefined,
    'At least one field must be provided for update'
  );

export const leadQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  contactId: z.string().cuid().optional(),
  accountId: z.string().cuid().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  ownerId: z.string().cuid().optional(),
  sortBy: z.enum(['source', 'status', 'priority', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: includeDeletedQueryParam,
});

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
export type LeadQueryInput = z.infer<typeof leadQuerySchema>;
