import { z } from 'zod';

/**
 * Zod validation schemas for Document Link (shareable link) operations.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

const futureExpirySchema = z
  .string()
  .datetime('Valid expiry date is required')
  .refine((val) => new Date(val).getTime() > Date.now(), {
    message: 'Expiry date must be in the future',
  });

export const documentLinkCreateSchema = z.object({
  documentId: z.string().cuid('Valid document ID is required'),
  expiresAt: futureExpirySchema,
  maxAccess: z.coerce.number().int().positive().optional().nullable(),
});

export const salesDocumentShareLinkCreateSchema = z.object({
  entityType: z.enum(['proposal', 'quotation', 'estimate', 'contract']),
  entityId: z.string().cuid('Valid entity ID is required'),
  expiresAt: futureExpirySchema,
  maxAccess: z.coerce.number().int().positive().optional().nullable(),
});

export const documentLinkVerifySchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export type DocumentLinkCreateInput = z.infer<typeof documentLinkCreateSchema>;
export type SalesDocumentShareLinkCreateInput = z.infer<typeof salesDocumentShareLinkCreateSchema>;
export type DocumentLinkVerifyInput = z.infer<typeof documentLinkVerifySchema>;
