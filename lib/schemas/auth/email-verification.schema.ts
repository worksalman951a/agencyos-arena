import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .normalize()
  .toLowerCase()
  .email('A valid e-mail address is required')
  .max(200);

export const emailVerificationRequestSchema = z.object({ email: emailSchema }).strict();
export const emailVerificationConfirmSchema = z
  .object({ token: z.string().min(1).max(200) })
  .strict();
