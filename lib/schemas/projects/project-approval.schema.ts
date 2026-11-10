import { z } from 'zod';

export const PROJECT_APPROVAL_STATUS_VALUES = [
  'pending',
  'approved',
  'changes_requested',
  'rejected',
] as const;

export const projectApprovalCreateSchema = z
  .object({
    projectId: z.string().cuid('Valid project ID is required'),
    contactId: z.string().cuid().optional().nullable(),
    status: z.enum(PROJECT_APPROVAL_STATUS_VALUES).default('pending'),
    feedback: z.string().trim().max(5000).optional().nullable(),
  })
  .strict();

export const projectApprovalUpdateSchema = z
  .object({
    contactId: z.string().cuid().optional().nullable(),
    status: z.enum(PROJECT_APPROVAL_STATUS_VALUES).optional(),
    feedback: z.string().trim().max(5000).optional().nullable(),
  })
  .partial()
  .strict()
  .refine(
    (data) =>
      data.contactId !== undefined || data.status !== undefined || data.feedback !== undefined,
    'At least one field must be provided for update'
  );

export type ProjectApprovalCreateInput = z.infer<typeof projectApprovalCreateSchema>;
export type ProjectApprovalUpdateInput = z.infer<typeof projectApprovalUpdateSchema>;
