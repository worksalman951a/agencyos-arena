import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for Pipeline CRUD operations.
 * All schemas enforce server-side validation on every request.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

const basePipelineSchema = z.object({
  name: z.string().min(1, 'Pipeline name is required').max(200),
  description: z.string().max(1000).optional().nullable(),
  isDefault: z.boolean().optional(),
});

export const pipelineCreateSchema = basePipelineSchema.strict();

export const pipelineUpdateSchema = basePipelineSchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.name !== undefined || data.description !== undefined || data.isDefault !== undefined,
    'At least one field must be provided for update'
  );

export const pipelineQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: includeDeletedQueryParam,
});

export type PipelineCreateInput = z.infer<typeof pipelineCreateSchema>;
export type PipelineUpdateInput = z.infer<typeof pipelineUpdateSchema>;
export type PipelineQueryInput = z.infer<typeof pipelineQuerySchema>;
