/**
 * Invitation validation (pure module).
 *
 * Kept out of the `'use server'` service on purpose: a server-action module may
 * only export async functions, and the schemas are needed by route handlers and
 * tests as values.
 */

import { z } from 'zod';

/** How long an invitation stays redeemable. */
export const INVITATION_TTL_DAYS = 7;

export const invitationCreateSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid e-mail address is required').max(200),
    roleId: z.string().min(1, 'roleId is required').max(120),
  })
  .strict();

export const invitationAcceptSchema = z
  .object({
    token: z.string().trim().min(20, 'token is required').max(200),
  })
  .strict();
