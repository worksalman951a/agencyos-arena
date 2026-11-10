import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for Project CRUD operations.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

export const PROJECT_STATUS_VALUES = ['active', 'on-hold', 'completed', 'archived'] as const;
export const TASK_STATUS_VALUES = ['todo', 'in-progress', 'review', 'done'] as const;
export const TASK_PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;

const nonNegativeDecimalString = z.string().refine(
  (val) => {
    const trimmed = val.trim();
    if (!trimmed) return false;
    const parsed = Number(trimmed);
    return !Number.isNaN(parsed) && Number.isFinite(parsed) && parsed >= 0;
  },
  { message: 'Must be a valid non-negative number' }
);

const validDateString = z.string().refine(
  (val) => {
    const trimmed = val.trim();
    if (!trimmed) return false;
    return !Number.isNaN(new Date(trimmed).getTime());
  },
  { message: 'Must be a valid date' }
);

const validProjectStatus = z
  .string()
  .refine((val) => (PROJECT_STATUS_VALUES as readonly string[]).includes(val), {
    message: 'Invalid project status',
  });

const validTaskStatus = z
  .string()
  .refine((val) => (TASK_STATUS_VALUES as readonly string[]).includes(val), {
    message: 'Invalid task status',
  });

const validTaskPriority = z
  .string()
  .refine((val) => (TASK_PRIORITY_VALUES as readonly string[]).includes(val), {
    message: 'Invalid task priority',
  });

const projectFields = {
  clientId: z.string().cuid().optional().nullable(),
  templateId: z.string().cuid().optional().nullable(),
  name: z.string().trim().min(1, 'Project name is required').max(200),
  budget: nonNegativeDecimalString.optional().nullable(),
  startDate: validDateString.optional().nullable(),
  endDate: validDateString.optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
};

export const projectCreateSchema = z
  .object({
    ...projectFields,
    status: validProjectStatus.default('active'),
  })
  .strict()
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.endDate).getTime() >= new Date(data.startDate).getTime();
      }
      return true;
    },
    { message: 'End date must be on or after start date', path: ['endDate'] }
  );

export const projectUpdateSchema = z
  .object({
    clientId: projectFields.clientId,
    templateId: projectFields.templateId,
    name: projectFields.name.optional(),
    status: validProjectStatus.optional(),
    budget: projectFields.budget,
    startDate: projectFields.startDate,
    endDate: projectFields.endDate,
    description: projectFields.description,
  })
  .strict()
  .refine(
    (data) =>
      data.clientId !== undefined ||
      data.templateId !== undefined ||
      data.name !== undefined ||
      data.status !== undefined ||
      data.budget !== undefined ||
      data.startDate !== undefined ||
      data.endDate !== undefined ||
      data.description !== undefined,
    'At least one field must be provided for update'
  )
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.endDate).getTime() >= new Date(data.startDate).getTime();
      }
      return true;
    },
    { message: 'End date must be on or after start date', path: ['endDate'] }
  );

export const projectQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  clientId: z.string().cuid().optional(),
  accountId: z.string().cuid().optional(),
  status: z.enum(PROJECT_STATUS_VALUES).optional(),
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
const userIdString = z.string().trim().min(1, 'Valid user ID is required').max(128);

const taskFields = {
  title: z.string().trim().min(1, 'Task title is required').max(200),
  assigneeId: userIdString.optional().nullable(),
  milestoneId: z.string().cuid().optional().nullable(),
  dueDate: validDateString.optional().nullable(),
  estimatedHours: nonNegativeDecimalString.optional().nullable(),
};

export const projectTaskSchema = z
  .object({
    ...taskFields,
    status: validTaskStatus.default('todo'),
    priority: validTaskPriority.default('medium'),
  })
  .strict();

export const projectTaskUpdateSchema = z
  .object({
    title: taskFields.title.optional(),
    status: validTaskStatus.optional(),
    priority: validTaskPriority.optional(),
    assigneeId: taskFields.assigneeId,
    milestoneId: taskFields.milestoneId,
    dueDate: taskFields.dueDate,
    estimatedHours: taskFields.estimatedHours,
  })
  .strict()
  .refine(
    (data) =>
      data.title !== undefined ||
      data.status !== undefined ||
      data.priority !== undefined ||
      data.assigneeId !== undefined ||
      data.milestoneId !== undefined ||
      data.dueDate !== undefined ||
      data.estimatedHours !== undefined,
    'At least one field must be provided for update'
  );

export type ProjectTaskInput = z.infer<typeof projectTaskSchema>;
export type ProjectTaskUpdateInput = z.infer<typeof projectTaskUpdateSchema>;
