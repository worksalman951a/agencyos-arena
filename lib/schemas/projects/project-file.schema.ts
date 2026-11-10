import { z } from 'zod';

const userIdString = z.string().trim().min(1, 'Valid user ID is required').max(128);

export const projectFileCreateSchema = z.object({
  projectId: z.string().cuid('Valid project ID is required'),
  taskId: z.string().cuid().optional().nullable(),
  fileAssetId: z.string().cuid('Valid file asset ID is required'),
  userId: userIdString.optional().nullable(),
});

export const projectFileUpdateSchema = z
  .object({
    taskId: z.string().cuid().optional().nullable(),
    userId: userIdString.optional().nullable(),
  })
  .partial()
  .strict()
  .refine(
    (data) => data.taskId !== undefined || data.userId !== undefined,
    'At least one field must be provided for update'
  );

export type ProjectFileCreateInput = z.infer<typeof projectFileCreateSchema>;
export type ProjectFileUpdateInput = z.infer<typeof projectFileUpdateSchema>;
