import { z } from 'zod';

export const taskCommentCreateSchema = z.object({
  taskId: z.string().cuid('Valid task ID is required'),
  /**
   * Deprecated: the comment author is always the authenticated session user.
   * Accepted (and ignored) so older clients that still send it keep working;
   * it can never be used to attribute a comment to somebody else.
   */
  userId: z.string().cuid().optional(),
  comment: z.string().min(1, 'Comment is required').max(10000),
});

export const taskCommentUpdateSchema = z
  .object({
    comment: z.string().min(1).max(10000).optional(),
  })
  .partial()
  .strict()
  .refine((data) => data.comment !== undefined, 'Comment must be provided for update');

export type TaskCommentCreateInput = z.infer<typeof taskCommentCreateSchema>;
export type TaskCommentUpdateInput = z.infer<typeof taskCommentUpdateSchema>;
