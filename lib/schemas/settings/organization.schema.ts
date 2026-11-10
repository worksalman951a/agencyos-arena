/**
 * Organization settings: wire schema, defaults and safe reads.
 *
 * `Organization.settings` is a JSON column, so nothing in the database enforces
 * its shape. Before this schema existed the settings endpoint accepted any
 * object and spread it into the column: arbitrary strings as currencies, floats
 * as counters, unknown keys persisted silently. Validation now happens once, at
 * the API boundary, and every read goes through `normalizeOrganizationSettings`
 * so a hand-edited or legacy value can never break a page.
 *
 * Optional fields accept `null` to mean "clear this value" — JSON.stringify
 * drops `undefined`, which previously made it impossible to empty a field.
 */

import { z } from 'zod';

import { DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrencyCode } from '@/lib/currencies';
import { normalizeBrandColor, normalizeLogoUrl } from '@/lib/branding';

export const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Slugs are upper-case, short, and printed in front of the sequence number. */
const prefixSchema = z
  .string()
  .trim()
  .min(1, 'Prefix is required')
  .max(12, 'Prefix must be 12 characters or fewer')
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Use letters, numbers and dashes only')
  .transform((value) => value.toUpperCase());

/**
 * Optional text: `undefined` = untouched, `null`/`''` = clear, otherwise the
 * trimmed value. The distinction matters — a transform that turns an absent key
 * into `null` would make every partial save clear the fields it did not send.
 */
const optionalText = (max: number, message: string) =>
  z
    .union([z.string().trim().max(max, message), z.null()])
    .optional()
    .transform((value): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null || value === '') return null;
      return value;
    });

export const organizationSettingsSchema = z
  .object({
    // Branding
    brandName: optionalText(120, 'Brand name must be 120 characters or fewer'),
    brandColor: z
      .union([z.string().trim(), z.null()])
      .optional()
      .superRefine((value, ctx) => {
        if (typeof value === 'string' && value !== '' && !normalizeBrandColor(value)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Brand colour must be a hex value such as #047857',
          });
        }
      })
      .transform((value): string | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null || value === '') return null;
        return normalizeBrandColor(value);
      }),
    logoUrl: z
      .union([z.string().trim().max(500, 'Logo URL must be 500 characters or fewer'), z.null()])
      .optional()
      .superRefine((value, ctx) => {
        if (typeof value === 'string' && value !== '' && !normalizeLogoUrl(value)) {
          ctx.addIssue({ code: 'custom', message: 'Logo URL must be an absolute http(s) URL' });
        }
      })
      .transform((value): string | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null || value === '') return null;
        return value;
      }),

    // Contact details
    contactEmail: z
      .union([z.string().trim().max(200, 'Email must be 200 characters or fewer'), z.null()])
      .optional()
      .superRefine((value, ctx) => {
        if (typeof value === 'string' && value !== '' && !z.email().safeParse(value).success) {
          ctx.addIssue({ code: 'custom', message: 'Enter a valid email address' });
        }
      })
      .transform((value): string | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null || value === '') return null;
        return value;
      }),
    contactPhone: optionalText(50, 'Phone must be 50 characters or fewer'),
    address: optionalText(200, 'Address must be 200 characters or fewer'),
    city: optionalText(100, 'City must be 100 characters or fewer'),
    country: optionalText(100, 'Country must be 100 characters or fewer'),
    postalCode: optionalText(20, 'Postal code must be 20 characters or fewer'),

    // Financial defaults
    defaultCurrency: z
      .union([z.string().trim(), z.null()])
      .optional()
      .superRefine((value, ctx) => {
        if (typeof value === 'string' && value !== '' && !isSupportedCurrency(value)) {
          ctx.addIssue({ code: 'custom', message: 'Select a supported ISO currency code' });
        }
      })
      .transform((value): string | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null || value === '') return null;
        return normalizeCurrencyCode(value);
      }),
    dateFormat: z.enum(DATE_FORMATS).nullable().optional(),

    // Invoice numbering
    invoiceNumberPrefix: prefixSchema.nullable().optional(),
    invoiceNextNumber: z.coerce
      .number()
      .int('Next invoice number must be a whole number')
      .min(1, 'Next invoice number must be at least 1')
      .max(999999, 'Next invoice number is too large')
      .nullable()
      .optional(),
    invoiceTaxDefault: z.coerce
      .number()
      .min(0, 'Default tax cannot be negative')
      .max(100, 'Default tax cannot exceed 100%')
      .nullable()
      .optional(),

    // Proposal numbering
    proposalNumberPrefix: prefixSchema.nullable().optional(),
    proposalNextNumber: z.coerce
      .number()
      .int('Next proposal number must be a whole number')
      .min(1, 'Next proposal number must be at least 1')
      .max(999999, 'Next proposal number is too large')
      .nullable()
      .optional(),
    proposalValidDays: z.coerce
      .number()
      .int('Validity must be a whole number of days')
      .min(1, 'Validity must be at least 1 day')
      .max(365, 'Validity cannot exceed 365 days')
      .nullable()
      .optional(),
  })
  .strict();

/**
 * Keys that always carry a value. Sending `null` for one of these is rejected
 * instead of silently falling back to a default — clearing the invoice counter,
 * for example, must never look like a sequence reset.
 */
export const REQUIRED_SETTING_KEYS = [
  'defaultCurrency',
  'dateFormat',
  'invoiceNumberPrefix',
  'invoiceNextNumber',
  'invoiceTaxDefault',
  'proposalNumberPrefix',
  'proposalNextNumber',
  'proposalValidDays',
] as const;

/** Patch schema: same fields, but required keys cannot be cleared with `null`. */
export const organizationSettingsPatchSchema = organizationSettingsSchema.superRefine(
  (value, ctx) => {
    for (const key of REQUIRED_SETTING_KEYS) {
      if ((value as Record<string, unknown>)[key] === null) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'This value cannot be cleared',
        });
      }
    }
  }
);

/**
 * Split a validated patch into values to write and keys to delete.
 *
 * `null` means "clear" — JSON.stringify drops `undefined`, which is why the old
 * write path could never empty a field. Deleting the key (rather than storing
 * `null`) keeps the JSON column canonical: a reader never has to distinguish
 * "absent" from "explicitly empty".
 */
export function settingsPatchFromParsed(parsed: OrganizationSettings): {
  set: Record<string, string | number>;
  clear: string[];
} {
  const set: Record<string, string | number> = {};
  const clear: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined) continue;
    if (value === null) {
      if (!(REQUIRED_SETTING_KEYS as readonly string[]).includes(key)) clear.push(key);
      continue;
    }
    if (key === 'invoiceTaxDefault' && typeof value === 'number') {
      // Stored as a plain percentage number, rounded to 2dp to avoid binary
      // noise from `Number('7.5')` style input.
      set[key] = Math.round(value * 100) / 100;
      continue;
    }
    set[key] = value as string | number;
  }

  return { set, clear };
}

/** Merge a patch into stored settings without mutating the input. */
export function applySettingsPatch(
  current: Record<string, unknown>,
  patch: { set: Record<string, string | number>; clear: string[] }
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const key of patch.clear) delete next[key];
  return { ...next, ...patch.set };
}

export type OrganizationSettingsInput = z.input<typeof organizationSettingsSchema>;
export type OrganizationSettings = z.output<typeof organizationSettingsSchema>;

export const organizationUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Organization name is required')
      .max(120, 'Organization name must be 120 characters or fewer')
      .optional(),
    settings: organizationSettingsSchema.optional(),
  })
  .strict();

export type OrganizationUpdateInput = z.input<typeof organizationUpdateSchema>;

/** Defaults used when a key is absent from the stored JSON. */
export const DEFAULT_ORGANIZATION_SETTINGS = {
  defaultCurrency: DEFAULT_CURRENCY,
  dateFormat: 'MM/DD/YYYY' as DateFormat,
  invoiceNumberPrefix: 'INV',
  invoiceNextNumber: 1,
  invoiceTaxDefault: 0,
  proposalNumberPrefix: 'PRP',
  proposalNextNumber: 1,
  proposalValidDays: 30,
} as const;

/**
 * Coerce a stored JSON value into a fully-typed settings object.
 *
 * Invalid individual values fall back to defaults rather than throwing, so a
 * legacy row (`defaultCurrency: "pkr"` lower-case, or a float counter) still
 * renders and can be corrected through the UI.
 */
export function normalizeOrganizationSettings(
  raw: unknown
): Required<
  Pick<
    OrganizationSettings,
    | 'defaultCurrency'
    | 'dateFormat'
    | 'invoiceNumberPrefix'
    | 'invoiceNextNumber'
    | 'invoiceTaxDefault'
    | 'proposalNumberPrefix'
    | 'proposalNextNumber'
    | 'proposalValidDays'
  >
> &
  OrganizationSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const parsed = organizationSettingsSchema.safeParse(source);
  const values: Partial<OrganizationSettings> = parsed.success ? parsed.data : {};

  // Field-by-field recovery when the whole object failed validation (one bad
  // field must not discard the rest).
  const fallbackField = <K extends keyof OrganizationSettings>(
    key: K,
    validate: (v: unknown) => OrganizationSettings[K] | undefined
  ): OrganizationSettings[K] | undefined => {
    if (values[key] !== undefined) return values[key];
    if (!(key in source)) return undefined;
    return validate(source[key]);
  };

  const brandColor =
    values.brandColor !== undefined
      ? values.brandColor
      : fallbackField('brandColor', (v) =>
          typeof v === 'string' ? normalizeBrandColor(v) : undefined
        );

  const defaultCurrency =
    values.defaultCurrency !== undefined
      ? values.defaultCurrency
      : fallbackField('defaultCurrency', (v) =>
          typeof v === 'string' ? normalizeCurrencyCode(v) : undefined
        );

  const intOr = (value: unknown): number | undefined => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= 999999 ? n : undefined;
  };

  const textOr = (key: keyof OrganizationSettings) => {
    const value = values[key];
    if (typeof value === 'string' && value.length > 0) return value;
    const rawValue = source[key];
    return typeof rawValue === 'string' && rawValue.trim().length > 0 ? rawValue.trim() : null;
  };

  return {
    ...values,
    brandName: textOr('brandName'),
    brandColor: brandColor ?? null,
    logoUrl:
      values.logoUrl !== undefined
        ? values.logoUrl
        : typeof source.logoUrl === 'string'
          ? normalizeLogoUrl(source.logoUrl)
          : null,
    contactEmail: textOr('contactEmail'),
    contactPhone: textOr('contactPhone'),
    address: textOr('address'),
    city: textOr('city'),
    country: textOr('country'),
    postalCode: textOr('postalCode'),
    defaultCurrency: defaultCurrency ?? DEFAULT_ORGANIZATION_SETTINGS.defaultCurrency,
    dateFormat: values.dateFormat ?? DEFAULT_ORGANIZATION_SETTINGS.dateFormat,
    invoiceNumberPrefix:
      values.invoiceNumberPrefix ??
      (typeof source.invoiceNumberPrefix === 'string' && source.invoiceNumberPrefix.trim()
        ? source.invoiceNumberPrefix.trim().toUpperCase()
        : DEFAULT_ORGANIZATION_SETTINGS.invoiceNumberPrefix),
    invoiceNextNumber:
      values.invoiceNextNumber ??
      intOr(source.invoiceNextNumber) ??
      DEFAULT_ORGANIZATION_SETTINGS.invoiceNextNumber,
    invoiceTaxDefault:
      values.invoiceTaxDefault ??
      (typeof source.invoiceTaxDefault === 'number' ? source.invoiceTaxDefault : undefined) ??
      DEFAULT_ORGANIZATION_SETTINGS.invoiceTaxDefault,
    proposalNumberPrefix:
      values.proposalNumberPrefix ??
      (typeof source.proposalNumberPrefix === 'string' && source.proposalNumberPrefix.trim()
        ? source.proposalNumberPrefix.trim().toUpperCase()
        : DEFAULT_ORGANIZATION_SETTINGS.proposalNumberPrefix),
    proposalNextNumber:
      values.proposalNextNumber ??
      intOr(source.proposalNextNumber) ??
      DEFAULT_ORGANIZATION_SETTINGS.proposalNextNumber,
    proposalValidDays:
      values.proposalValidDays ??
      intOr(source.proposalValidDays) ??
      DEFAULT_ORGANIZATION_SETTINGS.proposalValidDays,
  };
}

/** Flatten zod issues into `{ field: message }` for inline form errors. */
export function fieldErrorsFromIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path
      .filter((segment) => segment !== 'settings')
      .join('.')
      .replace(/^\./, '');
    if (!errors[key || '_']) errors[key || '_'] = issue.message;
  }
  return errors;
}
