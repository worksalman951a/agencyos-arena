import { z } from 'zod';

export const portalActionSchema = z.object({
  documentId: z.string().min(1, 'Document ID is required'),
  documentType: z.enum(['proposal', 'quotation', 'contract']),
  action: z.enum(['accept', 'reject']),
  reason: z.string().max(1000).optional(),
  // Mandatory server-issued document version binding (e.g. ISO timestamp or integer version)
  expectedVersion: z.string().min(1, 'Document version binding is required'),
  // For contract electronic acceptance
  signerName: z.string().min(1, 'Signer name is required').max(100).optional(),
  signerEmail: z.string().email('Valid signer email is required').optional(),
  consentGiven: z.boolean().optional(),
});

export type PortalActionInput = z.infer<typeof portalActionSchema>;
