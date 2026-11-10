/**
 * User profile settings schema.
 *
 * `null` (or an empty string) means "clear this value": JSON.stringify drops
 * `undefined`, so before this schema an empty display name or avatar could never
 * be cleared once set.
 */

import { z } from 'zod';

import { normalizeLogoUrl } from '@/lib/branding';

/**
 * `undefined` = untouched, `null`/`''` = clear. Collapsing `undefined` into
 * `null` here would make a partial save wipe fields it never mentioned.
 */
const clearableText = (max: number, message: string) =>
  z
    .union([z.string().trim().max(max, message), z.null()])
    .optional()
    .transform((value): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null || value === '') return null;
      return value;
    });

export const userProfileUpdateSchema = z
  .object({
    displayName: clearableText(120, 'Display name must be 120 characters or fewer'),
    avatarUrl: clearableText(500, 'Avatar URL must be 500 characters or fewer').refine(
      (value) => value === undefined || value === null || normalizeLogoUrl(value) !== null,
      { message: 'Avatar URL must be an absolute http(s) URL' }
    ),
  })
  .strict();

export type UserProfileUpdateInput = z.input<typeof userProfileUpdateSchema>;
export type UserProfileUpdate = z.output<typeof userProfileUpdateSchema>;
