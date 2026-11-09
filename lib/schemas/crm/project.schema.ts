import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for Project CRUD operations.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

const baseProjectSchema = z.object({
  clientId: z.string().cuid().optional().nullable(),
  name: z.string().min(1, 'Project name is required').max(200),
  status: z.string().min(1).max(50).default('active'),
  budget: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
});

export const projectCreateSchema = baseProjectSchema.strict();

export const projectUpdateSchema = baseProjectSchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.clientId !== undefined ||
      data.name !== undefined ||
      data.status !== undefined ||
      data.budget !== undefined ||
      data.startDate !== undefined ||
      data.endDate !== undefined ||
      data.description !== undefined,
    'At least one field must be provided for update'
  );

export const projectQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  clientId: z.string().cuid().optional(),
  status: z.string().optional(),
  sortBy: z
    .enum(['name', 'status', 'budget', 'createdAt', 'updatedAt', 'endDate'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: includeDeletedQueryParam,
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type ProjectQueryInput = z.infer<typeof projectQuerySchema>;

/**
 * Task schema for projects.
 */
export const projectTaskSchema = z.object({
  title: z.string().min(1, 'Task title is required').max(200),
  status: z.string().min(1).max(50).default('todo'),
  priority: z.string().min(1).max(20).default('medium'),
  assigneeId: z.string().cuid().optional().nullable(),
  milestoneId: z.string().cuid().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  estimatedHours: z.string().optional().nullable(),
});

export type ProjectTaskInput = z.infer<typeof projectTaskSchema>;
