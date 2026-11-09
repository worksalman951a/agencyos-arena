import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for Opportunity CRUD operations.
 * All schemas enforce server-side validation on every request.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

const baseOpportunitySchema = z.object({
  contactId: z.string().cuid().optional().nullable(),
  accountId: z.string().cuid().optional().nullable(),
  leadId: z.string().cuid().optional().nullable(),
  pipelineId: z.string().cuid().optional().nullable(),
  stageId: z.string().cuid().optional().nullable(),
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional().nullable(),
  value: z.string().optional().nullable(),
  currency: z.string().min(1).max(10).default('USD'),
  closeDate: z.string().optional().nullable(),
  ownerId: z.string().cuid().optional().nullable(),
  status: z.string().min(1, 'Status is required').max(50),
  probability: z.string().optional().nullable(),
  lossReason: z.string().max(1000).optional().nullable(),
});

export const opportunityCreateSchema = baseOpportunitySchema.strict();

export const opportunityUpdateSchema = baseOpportunitySchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.contactId !== undefined ||
      data.accountId !== undefined ||
      data.leadId !== undefined ||
      data.pipelineId !== undefined ||
      data.stageId !== undefined ||
      data.title !== undefined ||
      data.description !== undefined ||
      data.value !== undefined ||
      data.currency !== undefined ||
      data.closeDate !== undefined ||
      data.ownerId !== undefined ||
      data.status !== undefined ||
      data.probability !== undefined ||
      data.lossReason !== undefined,
    'At least one field must be provided for update'
  );

export const opportunityQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  contactId: z.string().cuid().optional(),
  accountId: z.string().cuid().optional(),
  leadId: z.string().cuid().optional(),
  pipelineId: z.string().cuid().optional(),
  stageId: z.string().cuid().optional(),
  status: z.string().optional(),
  ownerId: z.string().cuid().optional(),
  sortBy: z
    .enum(['title', 'status', 'value', 'closeDate', 'createdAt', 'updatedAt'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: includeDeletedQueryParam,
});

export type OpportunityCreateInput = z.infer<typeof opportunityCreateSchema>;
export type OpportunityUpdateInput = z.infer<typeof opportunityUpdateSchema>;
export type OpportunityQueryInput = z.infer<typeof opportunityQuerySchema>;
