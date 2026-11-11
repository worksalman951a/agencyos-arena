import { z } from 'zod';

/**
 * Zod validation schemas for Document Template operations.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

export const templateCreateSchema = z
  .object({
    name: z.string().min(1, 'Template name is required').max(200),
    type: z.string().min(1, 'Template type is required').max(50),
    content: z.string().optional().nullable(),
    variables: z.record(z.string(), z.string()).optional().nullable(),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const templateUpdateSchema = z
  .object({
    name: z.string().min(1, 'Template name is required').max(200).optional(),
    type: z.string().min(1, 'Template type is required').max(50).optional(),
    content: z.string().optional().nullable(),
    variables: z.record(z.string(), z.string()).optional().nullable(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.type !== undefined ||
      data.content !== undefined ||
      data.variables !== undefined ||
      data.isDefault !== undefined,
    'At least one field must be provided for update'
  );

export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;
