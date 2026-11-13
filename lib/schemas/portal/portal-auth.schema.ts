import { z } from 'zod';

export const clientPortalInviteSchema = z
  .object({
    contactId: z.string().min(1, 'Valid contact ID is required'),
    email: z.string().trim().toLowerCase().email('A valid email address is required').max(200),
  })
  .strict();

export const clientPortalRevokeSchema = z
  .object({
    contactId: z.string().min(1, 'Valid contact ID is required'),
    reason: z
      .string()
      .trim()
      .min(3, 'A reason of at least 3 characters is required')
      .max(300)
      .optional(),
  })
  .strict();

/** Reading a contact's portal access state (administration widget). */
export const clientPortalStatusSchema = z
  .object({
    contactId: z.string().min(1, 'Valid contact ID is required'),
  })
  .strict();

export const clientPortalLoginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid email address is required').max(200),
  })
  .strict();

export const clientPortalVerifyTokenSchema = z
  .object({
    token: z.string().trim().min(24, 'Valid token is required').max(200),
  })
  .strict();

export type ClientPortalInviteInput = z.infer<typeof clientPortalInviteSchema>;
export type ClientPortalRevokeInput = z.infer<typeof clientPortalRevokeSchema>;
export type ClientPortalStatusInput = z.infer<typeof clientPortalStatusSchema>;
export type ClientPortalLoginRequestInput = z.infer<typeof clientPortalLoginRequestSchema>;
export type ClientPortalVerifyTokenInput = z.infer<typeof clientPortalVerifyTokenSchema>;
