/** Member administration validation (pure module). */

import { z } from 'zod';

export const USER_STATUSES = ['active', 'suspended', 'invited'] as const;

export const adminUserUpdateSchema = z
  .object({
    /** Id of a role that exists in the actor's organization. */
    roleId: z.string().min(1).max(120).optional(),
    status: z.enum(USER_STATUSES).optional(),
  })
  .strict();

export const roleUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    permissionCodes: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  })
  .strict();

export const roleCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    description: z.string().trim().max(500).optional(),
    permissionCodes: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  })
  .strict();

export const auditLogQuerySchema = z
  .object({
    action: z.string().trim().max(80).optional(),
    entityType: z.string().trim().max(80).optional(),
    entityId: z.string().trim().max(120).optional(),
    actorId: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(1000).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();
