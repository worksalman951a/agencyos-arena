import { z } from 'zod';

const validHours = z.string().refine(
  (val) => {
    const trimmed = val.trim();
    if (!trimmed) return false;
    const n = Number(trimmed);
    return !Number.isNaN(n) && Number.isFinite(n) && n > 0 && n <= 1000;
  },
  { message: 'Hours must be a positive number up to 1000' }
);

const validDate = z.string().refine(
  (val) => {
    const trimmed = val.trim();
    if (!trimmed) return false;
    return !Number.isNaN(new Date(trimmed).getTime());
  },
  { message: 'Valid date is required' }
);

const userIdString = z.string().trim().min(1, 'Valid user ID is required').max(128);

export const timeEntryCreateSchema = z
  .object({
    userId: userIdString.optional().nullable(),
    taskId: z.string().cuid().optional().nullable(),
    date: validDate,
    hours: validHours,
    description: z.string().trim().max(5000).optional().nullable(),
    billable: z.boolean().default(false),
  })
  .strict();

export const timeEntryUpdateSchema = z
  .object({
    userId: userIdString.optional().nullable(),
    taskId: z.string().cuid().optional().nullable(),
    date: validDate.optional(),
    hours: validHours.optional(),
    description: z.string().trim().max(5000).optional().nullable(),
    billable: z.boolean().optional(),
  })
  .partial()
  .strict()
  .refine(
    (data) =>
      data.userId !== undefined ||
      data.taskId !== undefined ||
      data.date !== undefined ||
      data.hours !== undefined ||
      data.description !== undefined ||
      data.billable !== undefined,
    'At least one field must be provided for update'
  );

export type TimeEntryCreateInput = z.infer<typeof timeEntryCreateSchema>;
export type TimeEntryUpdateInput = z.infer<typeof timeEntryUpdateSchema>;
