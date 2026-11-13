import { z } from 'zod';
import { includeDeletedQueryParam } from '@/lib/schemas/query-params';
import {
  INVOICE_INITIAL_STATUSES,
  INVOICE_MANUAL_UPDATE_STATUSES,
} from '@/lib/schemas/crm/invoice-status';

/**
 * Zod validation schemas for Invoice CRUD operations.
 * All schemas enforce server-side validation on every request.
 * Organization ID is never accepted from the client - it is resolved
 * from the authenticated user's session context.
 */

const baseInvoiceSchema = z.object({
  clientId: z.string().cuid().optional().nullable(),
  /**
   * Optional project this invoice belongs to (Phase 5A). Only an id is accepted;
   * the service resolves it inside the caller's organization, and the composite
   * foreign key rejects a project of any other organization.
   *  - create: omitted / null -> no project
   *  - update: omitted -> unchanged, null -> unlink, id -> link / reassign
   */
  projectId: z.string().cuid().optional().nullable(),
  title: z.string().min(1, 'Title is required').max(200),
  currency: z.string().min(1).max(10).default('USD'),
  dueDate: z.string().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const invoiceCreateSchema = baseInvoiceSchema
  .extend({ status: z.enum(INVOICE_INITIAL_STATUSES).default('draft') })
  .strict();

export const invoiceUpdateSchema = baseInvoiceSchema
  .extend({
    status: z.enum(INVOICE_MANUAL_UPDATE_STATUSES).optional(),
    // No default on update. Inheriting the create-time `.default('USD')` made
    // every update that omitted `currency` (for example a project-only change)
    // rewrite the invoice to USD, and let an empty body pass the check below.
    currency: z.string().min(1).max(10),
  })
  .partial()
  .strict()
  .refine(
    (data) =>
      data.clientId !== undefined ||
      data.projectId !== undefined ||
      data.title !== undefined ||
      data.status !== undefined ||
      data.currency !== undefined ||
      data.dueDate !== undefined ||
      data.notes !== undefined,
    'At least one field must be provided for update'
  );

export const invoiceQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  clientId: z.string().cuid().optional(),
  /** Restrict the list to one project. Always combined with the caller's organization. */
  projectId: z.string().cuid().optional(),
  status: z.string().optional(),
  sortBy: z
    .enum(['title', 'status', 'total', 'createdAt', 'updatedAt', 'dueDate'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: includeDeletedQueryParam,
});

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;
export type InvoiceQueryInput = z.infer<typeof invoiceQuerySchema>;

/**
 * Line item schema for invoices.
 * Amounts are calculated server-side from quantity * unitPrice * (1 + taxRate).
 */
export const invoiceLineItemSchema = z.object({
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
});

export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemSchema>;

/**
 * Payment recording schema for invoices.
 */
export const invoicePaymentSchema = z.object({
  amount: z.string().refine(
    (val) => {
      const n = Number(val);
      return !isNaN(n) && n > 0;
    },
    { message: 'Payment amount must be a positive number' }
  ),
  method: z.string().min(1, 'Payment method is required').max(50),
  reference: z.string().optional().nullable(),
  paidAt: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
});

export type InvoicePaymentInput = z.infer<typeof invoicePaymentSchema>;
