import { z } from 'zod';

export const MILESTONE_STATUS_VALUES = ['pending', 'in_progress', 'completed'] as const;

const validDateString = z.string().refine(
  (val) => {
    const trimmed = val.trim();
    if (!trimmed) return false;
    return !Number.isNaN(new Date(trimmed).getTime());
  },
  { message: 'Valid due date is required' }
);

export const milestoneCreateSchema = z
  .object({
    projectId: z.string().cuid('Valid project ID is required'),
    name: z.string().trim().min(1, 'Milestone name is required').max(200),
    dueDate: validDateString.optional().nullable(),
    status: z.enum(MILESTONE_STATUS_VALUES).default('pending'),
  })
  .strict();

export const milestoneUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Milestone name is required').max(200).optional(),
    dueDate: validDateString.optional().nullable(),
    status: z.enum(MILESTONE_STATUS_VALUES).optional(),
  })
  .strict()
  .refine(
    (data) => data.name !== undefined || data.dueDate !== undefined || data.status !== undefined,
    'At least one field must be provided for update'
  );

export type MilestoneCreateInput = z.infer<typeof milestoneCreateSchema>;
export type MilestoneUpdateInput = z.infer<typeof milestoneUpdateSchema>;
