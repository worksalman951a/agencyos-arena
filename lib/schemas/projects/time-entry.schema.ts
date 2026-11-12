import { z } from 'zod';
import { isSupportedCurrency, normalizeCurrencyCode } from '@/lib/currencies';
import { isValidHourlyRateText, isValidHoursText } from '@/lib/projects/time-entry-billing';

const validHours = z
  .string()
  .trim()
  .refine((val) => isValidHoursText(val), {
    message: 'Hours must be a positive decimal number up to 1000 (max 4 decimal places)',
  });

const validHourlyRate = z
  .string()
  .trim()
  .refine((val) => isValidHourlyRateText(val), {
    message: 'Hourly rate must be a positive decimal number up to 1,000,000 (max 2 decimal places)',
  });

const validCurrency = z
  .string()
  .trim()
  .min(3, 'Currency code must be a valid 3-letter ISO code')
  .max(10, 'Currency code must be a valid 3-letter ISO code')
  .refine((val) => isSupportedCurrency(val), {
    message: 'Unsupported ISO 4217 currency code',
  })
  .transform((val) => normalizeCurrencyCode(val) ?? val.trim().toUpperCase());

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
    projectId: z.string().cuid().optional().nullable(),
    taskId: z.string().cuid().optional().nullable(),
    date: validDate,
    hours: validHours,
    description: z.string().trim().max(5000).optional().nullable(),
    billable: z.boolean().default(false),
    hourlyRate: validHourlyRate.optional().nullable(),
    currency: validCurrency.optional().nullable(),
  })
  .strict();

// Do NOT derive from timeEntryCreateSchema via `.partial()`: Zod carries field
// defaults (like `billable: false`) onto omitted keys during partial updates.
export const timeEntryUpdateSchema = z
  .object({
    userId: userIdString.optional().nullable(),
    projectId: z.string().cuid().optional().nullable(),
    taskId: z.string().cuid().optional().nullable(),
    date: validDate.optional(),
    hours: validHours.optional(),
    description: z.string().trim().max(5000).optional().nullable(),
    billable: z.boolean().optional(),
    hourlyRate: validHourlyRate.optional().nullable(),
    currency: validCurrency.optional().nullable(),
  })
  .strict()
  .refine(
    (data) =>
      data.userId !== undefined ||
      data.projectId !== undefined ||
      data.taskId !== undefined ||
      data.date !== undefined ||
      data.hours !== undefined ||
      data.description !== undefined ||
      data.billable !== undefined ||
      data.hourlyRate !== undefined ||
      data.currency !== undefined,
    'At least one field must be provided for update'
  );

export const timeEntryQuerySchema = z
  .object({
    taskId: z.string().cuid().optional(),
    projectId: z.string().cuid().optional(),
    userId: userIdString.optional(),
    billable: z.enum(['true', 'false']).optional(),
    from: z.string().trim().min(1).optional(),
    to: z.string().trim().min(1).optional(),
  })
  .strict();

export type TimeEntryCreateInput = z.infer<typeof timeEntryCreateSchema>;
export type TimeEntryUpdateInput = z.infer<typeof timeEntryUpdateSchema>;
export type TimeEntryQueryInput = z.infer<typeof timeEntryQuerySchema>;
