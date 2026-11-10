import { z } from 'zod';

export const projectTemplateCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Template name is required').max(200),
    description: z.string().trim().max(5000).optional().nullable(),
  })
  .strict();

export const projectTemplateUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Template name is required').max(200).optional(),
    description: z.string().trim().max(5000).optional().nullable(),
  })
  .partial()
  .strict()
  .refine(
    (data) => data.name !== undefined || data.description !== undefined,
    'At least one field must be provided for update'
  );

export type ProjectTemplateCreateInput = z.infer<typeof projectTemplateCreateSchema>;
export type ProjectTemplateUpdateInput = z.infer<typeof projectTemplateUpdateSchema>;
