import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';

/**
 * Zod validation schemas for Quotation CRUD operations.
 * All schemas enforce server-side validation on every request.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const;
export const QUOTATION_CREATE_STATUSES = ['draft', 'sent'] as const;

export const quotationCreateSchema = z
  .object({
    opportunityId: z.string().cuid().optional().nullable(),
    contactId: z.string().cuid().optional().nullable(),
    title: z.string().min(1, 'Title is required').max(200),
    status: z.enum(QUOTATION_CREATE_STATUSES).default('draft'),
    currency: z.string().min(1).max(10).default('USD'),
    validUntil: z.string().optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
  })
  .strict();

export const quotationUpdateSchema = z
  .object({
    opportunityId: z.string().cuid().optional().nullable(),
    contactId: z.string().cuid().optional().nullable(),
    title: z.string().min(1, 'Title is required').max(200).optional(),
    status: z.enum(QUOTATION_STATUSES).optional(),
    currency: z.string().min(1).max(10).optional(),
    validUntil: z.string().optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
  })
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

/**
 * Optional overrides for documents created from an accepted quotation.
 *
 * Source data (client, line items, pricing, taxes, currency) is never accepted
 * from the client here: the service copies it from the quotation. Only the
 * fields the target document legitimately owns are accepted.
 */
export const quotationInvoiceCreateSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200).optional(),
    dueDate: z.string().optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
  })
  .strict();

export const quotationAgreementCreateSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200).optional(),
  })
  .strict();

export type QuotationInvoiceCreateInput = z.infer<typeof quotationInvoiceCreateSchema>;
export type QuotationAgreementCreateInput = z.infer<typeof quotationAgreementCreateSchema>;

export const quotationQuerySchema = z.object({
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

export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>;
export type QuotationUpdateInput = z.infer<typeof quotationUpdateSchema>;
export type QuotationQueryInput = z.infer<typeof quotationQuerySchema>;

/**
 * Line item schema for quotations.
 * Amounts are calculated server-side from quantity * unitPrice * (1 + taxRate).
 */
export const quotationLineItemSchema = z.object({
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

export type QuotationLineItemInput = z.infer<typeof quotationLineItemSchema>;
