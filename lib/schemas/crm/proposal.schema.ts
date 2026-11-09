import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for Proposal CRUD operations.
 * All schemas enforce server-side validation on every request.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

const baseProposalSchema = z.object({
  opportunityId: z.string().cuid().optional().nullable(),
  contactId: z.string().cuid().optional().nullable(),
  title: z.string().min(1, 'Title is required').max(200),
  status: z.string().min(1).max(50).default('draft'),
  currency: z.string().min(1).max(10).default('USD'),
  validUntil: z.string().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const proposalCreateSchema = baseProposalSchema.strict();

export const proposalUpdateSchema = baseProposalSchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.opportunityId !== undefined ||
      data.contactId !== undefined ||
      data.title !== undefined ||
      data.status !== undefined ||
      data.currency !== undefined ||
      data.validUntil !== undefined ||
      data.notes !== undefined,
    'At least one field must be provided for update'
  );

export const proposalQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  opportunityId: z.string().cuid().optional(),
  contactId: z.string().cuid().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['title', 'status', 'total', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: includeDeletedQueryParam,
});

export type ProposalCreateInput = z.infer<typeof proposalCreateSchema>;
export type ProposalUpdateInput = z.infer<typeof proposalUpdateSchema>;
export type ProposalQueryInput = z.infer<typeof proposalQuerySchema>;

/**
 * Line item schema for proposals.
 * Amounts are calculated server-side from quantity * unitPrice * (1 + taxRate).
 */
export const proposalLineItemSchema = z.object({
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.string().refine(
    (val) => {
      const n = Number(val);
      return !isNaN(n) && n > 0;
    },
    { message: 'Quantity must be a positive number' }
  ),
  unitPrice: z.string().refine(
    (val) => {
      const n = Number(val);
      return !isNaN(n) && n >= 0;
    },
    { message: 'Unit price must be a non-negative number' }
  ),
  taxRate: z.string().refine(
    (val) => {
      const n = Number(val);
      return !isNaN(n) && n >= 0;
    },
    { message: 'Tax rate must be a non-negative number' }
  ),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export type ProposalLineItemInput = z.infer<typeof proposalLineItemSchema>;
