/**
 * Client-portal validation schemas (pure module).
 *
 * Kept out of the `'use server'` services so route handlers, forms and tests can
 * import them as values. Every schema is strict: unknown keys are rejected rather
 * than silently ignored, so a client cannot smuggle `organizationId`,
 * `actorId`, `userId` or a role into a write payload.
 */

import { z } from 'zod';

import { CLIENT_ROLE_PRESETS } from '@/lib/portal/capabilities';
import { PORTAL_RESOURCE_TYPES } from '@/lib/portal/resource-registry';

/** How long a client-portal invitation stays redeemable. */
export const CLIENT_INVITATION_TTL_DAYS = 7;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('A valid e-mail address is required')
  .max(200);

const roleSchema = z.enum(
  Object.keys(CLIENT_ROLE_PRESETS) as [
    keyof typeof CLIENT_ROLE_PRESETS,
    ...Array<keyof typeof CLIENT_ROLE_PRESETS>,
  ]
);

export const clientInvitationCreateSchema = z
  .object({
    email: emailSchema,
    contactId: z.string().min(1, 'contactId is required').max(120),
    role: roleSchema.default('client_viewer'),
    canViewInvoices: z.boolean().optional(),
    canDownloadFiles: z.boolean().optional(),
    canComment: z.boolean().optional(),
    canApprove: z.boolean().optional(),
  })
  .strict();

export type ClientInvitationCreateInput = z.infer<typeof clientInvitationCreateSchema>;

export const clientAccessUpdateSchema = z
  .object({
    status: z.enum(['active', 'suspended']).optional(),
    role: roleSchema.optional(),
    canViewInvoices: z.boolean().optional(),
    canDownloadFiles: z.boolean().optional(),
    canComment: z.boolean().optional(),
    canApprove: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const clientAccessRevokeSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const clientGrantCreateSchema = z
  .object({
    resourceType: z.enum(PORTAL_RESOURCE_TYPES),
    resourceId: z.string().min(1).max(120),
    canComment: z.boolean().optional(),
    canApprove: z.boolean().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const clientApprovalCreateSchema = z
  .object({
    clientAccessId: z.string().min(1).max(120),
    resourceType: z.enum(PORTAL_RESOURCE_TYPES),
    resourceId: z.string().min(1).max(120),
    title: z.string().trim().min(1, 'A title is required').max(200),
    description: z.string().trim().max(2000).optional(),
    dueAt: z.string().datetime().optional(),
  })
  .strict();

export const clientApprovalRespondSchema = z
  .object({
    decision: z.enum(['approved', 'changes_requested']),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export const clientCommentCreateSchema = z
  .object({
    resourceType: z.enum(PORTAL_RESOURCE_TYPES),
    resourceId: z.string().min(1).max(120),
    body: z.string().trim().min(1, 'A comment is required').max(4000),
    /** Internal staff only; the client service forces `client`. */
    visibility: z.enum(['client', 'internal']).optional(),
  })
  .strict();

export const clientCommentQuerySchema = z
  .object({
    resourceType: z.enum(PORTAL_RESOURCE_TYPES),
    resourceId: z.string().min(1).max(120),
  })
  .strict();
