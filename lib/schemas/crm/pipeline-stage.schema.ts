import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for Pipeline Stage CRUD operations.
 * All schemas enforce server-side validation on every request.
 * Organization ID and Pipeline ID are never accepted from the client
 * for scoping - they are resolved from the authenticated user's session
 * context and the route parameter.
 */

const basePipelineStageSchema = z.object({
  name: z.string().min(1, 'Stage name is required').max(200),
  order: z.number().int().min(1).optional(),
  color: z.string().max(20).optional().nullable(),
  probability: z.number().min(0).max(100).optional().nullable(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
});

export const pipelineStageCreateSchema = basePipelineStageSchema.strict();

export const pipelineStageUpdateSchema = basePipelineStageSchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.order !== undefined ||
      data.color !== undefined ||
      data.probability !== undefined ||
      data.isWon !== undefined ||
      data.isLost !== undefined,
    'At least one field must be provided for update'
  );

export const pipelineStageQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['order', 'name', 'createdAt', 'updatedAt']).default('order'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  includeDeleted: includeDeletedQueryParam,
});

export type PipelineStageCreateInput = z.infer<typeof pipelineStageCreateSchema>;
export type PipelineStageUpdateInput = z.infer<typeof pipelineStageUpdateSchema>;
export type PipelineStageQueryInput = z.infer<typeof pipelineStageQuerySchema>;
