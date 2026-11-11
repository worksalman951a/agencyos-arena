import { z } from 'zod';

/**
 * Zod validation schemas for Contract CRUD operations.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

export const CONTRACT_CREATE_STATUSES = ['draft', 'sent'] as const;
export const CONTRACT_UPDATE_STATUSES = ['draft', 'sent', 'voided'] as const;

export const contractCreateSchema = z
  .object({
    proposalId: z.string().cuid().optional().nullable(),
    projectId: z.string().cuid().optional().nullable(),
    title: z.string().min(1, 'Title is required').max(200),
    status: z.enum(CONTRACT_CREATE_STATUSES).default('draft'),
  })
  .strict();

export const contractUpdateSchema = z
  .object({
    proposalId: z.string().cuid().optional().nullable(),
    projectId: z.string().cuid().optional().nullable(),
    title: z.string().min(1, 'Title is required').max(200).optional(),
    status: z.enum(CONTRACT_UPDATE_STATUSES).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.proposalId !== undefined ||
      data.projectId !== undefined ||
      data.title !== undefined ||
      data.status !== undefined,
    'At least one field must be provided for update'
  );

export const contractSignSchema = z.object({
  signatureReference: z.string().max(200).optional(),
  signerName: z.string().min(1, 'Signer name is required').max(200),
  signerEmail: z.string().email('Valid email is required'),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
export type ContractSignInput = z.infer<typeof contractSignSchema>;
