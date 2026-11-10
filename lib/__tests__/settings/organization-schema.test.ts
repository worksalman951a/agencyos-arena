/**
 * Organization settings schema tests.
 *
 * The settings page, the API route and the read path all share this module, so
 * these tests pin the behaviour that was previously broken:
 *  • clearing an optional field is possible (`null` / `''`),
 *  • required values can never be cleared into a silent default,
 *  • a corrupted JSON column degrades per field instead of failing entirely,
 *  • validation messages are surfaced per field.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORGANIZATION_SETTINGS,
  applySettingsPatch,
  fieldErrorsFromIssues,
  normalizeOrganizationSettings,
  organizationSettingsPatchSchema,
  organizationSettingsSchema,
  organizationUpdateSchema,
  settingsPatchFromParsed,
} from '@/lib/schemas/settings/organization.schema';

describe('organizationSettingsSchema', () => {
  it('accepts a realistic settings payload and upper-cases prefixes', () => {
    const parsed = organizationSettingsSchema.parse({
      brandName: 'Acme Studio',
      brandColor: '#047857',
      logoUrl: 'https://cdn.example.com/logo.png',
      contactEmail: 'hello@acme.test',
      defaultCurrency: 'pkr',
      invoiceNumberPrefix: 'inv',
      invoiceNextNumber: '42',
      invoiceTaxDefault: '7.5',
      proposalNumberPrefix: 'prp',
      proposalNextNumber: 9,
      proposalValidDays: 30,
      dateFormat: 'DD/MM/YYYY',
    });

    expect(parsed.invoiceNumberPrefix).toBe('INV');
    expect(parsed.proposalNumberPrefix).toBe('PRP');
    expect(parsed.defaultCurrency).toBe('PKR');
    expect(parsed.invoiceNextNumber).toBe(42);
    expect(parsed.invoiceTaxDefault).toBe(7.5);
  });

  it('rejects unknown keys instead of persisting them', () => {
    expect(organizationSettingsSchema.safeParse({ brandColour: '#ffffff' }).success).toBe(false);
  });

  it('rejects unsupported currencies and unsafe logo URLs', () => {
    const currency = organizationSettingsSchema.safeParse({ defaultCurrency: 'XYZ' });
    expect(currency.success).toBe(false);

    const logo = organizationSettingsSchema.safeParse({ logoUrl: 'javascript:alert(1)' });
    expect(logo.success).toBe(false);

    const color = organizationSettingsSchema.safeParse({ brandColor: 'rebeccapurple' });
    expect(color.success).toBe(false);
  });

  it('normalizes an empty optional string to null so it can be cleared', () => {
    const parsed = organizationSettingsSchema.parse({ brandName: '', contactPhone: '' });
    expect(parsed.brandName).toBeNull();
    expect(parsed.contactPhone).toBeNull();
  });
});

describe('organizationSettingsPatchSchema', () => {
  it('allows clearing optional fields', () => {
    const parsed = organizationSettingsPatchSchema.safeParse({ brandName: null, logoUrl: null });
    expect(parsed.success).toBe(true);
  });

  it('refuses to clear required values such as the invoice counter', () => {
    for (const key of ['invoiceNextNumber', 'proposalNextNumber', 'defaultCurrency']) {
      const parsed = organizationSettingsPatchSchema.safeParse({ [key]: null });
      expect(parsed.success, key).toBe(false);
    }
  });
});

describe('settingsPatchFromParsed / applySettingsPatch', () => {
  it('separates values to set from keys to delete and never stores null', () => {
    const parsed = organizationSettingsPatchSchema.parse({
      brandName: null,
      city: 'Multan',
      invoiceNumberPrefix: 'INV',
    });

    const patch = settingsPatchFromParsed(parsed);
    expect(patch.clear).toContain('brandName');
    expect(patch.set.city).toBe('Multan');
    expect(patch.set.invoiceNumberPrefix).toBe('INV');
    expect(Object.values(patch.set)).not.toContain(null);
  });

  it('applies a patch to stored settings without mutating the original object', () => {
    const stored = { brandName: 'Old', city: 'Lahore', invoiceNextNumber: 5 };
    const next = applySettingsPatch(stored, {
      set: { city: 'Multan' },
      clear: ['brandName'],
    });

    expect(next).toEqual({ city: 'Multan', invoiceNextNumber: 5 });
    expect(stored.brandName).toBe('Old');
  });
});

describe('normalizeOrganizationSettings', () => {
  it('fills defaults for an empty column', () => {
    const settings = normalizeOrganizationSettings({});
    expect(settings.defaultCurrency).toBe(DEFAULT_ORGANIZATION_SETTINGS.defaultCurrency);
    expect(settings.invoiceNumberPrefix).toBe('INV');
    expect(settings.proposalValidDays).toBe(30);
    expect(settings.brandName).toBeNull();
  });

  it('recovers per field from a corrupted column instead of discarding everything', () => {
    const settings = normalizeOrganizationSettings({
      defaultCurrency: 'pkr', // legacy lower-case value — recoverable
      invoiceNextNumber: 'not-a-number', // malformed — defaulted
      invoiceNumberPrefix: 'INV',
      brandName: 'Acme',
      contactEmail: 'not-an-email', // invalid — dropped, not fatal
    });

    expect(settings.defaultCurrency).toBe('PKR');
    expect(settings.invoiceNextNumber).toBe(DEFAULT_ORGANIZATION_SETTINGS.invoiceNextNumber);
    expect(settings.invoiceNumberPrefix).toBe('INV');
    expect(settings.brandName).toBe('Acme');
  });

  it('ignores a null or non-object column', () => {
    expect(normalizeOrganizationSettings(null).dateFormat).toBe(
      DEFAULT_ORGANIZATION_SETTINGS.dateFormat
    );
    expect(normalizeOrganizationSettings('nope').proposalNumberPrefix).toBe('PRP');
  });
});

describe('fieldErrorsFromIssues', () => {
  it('maps zod issues to field keys with the settings prefix removed', () => {
    const parsed = organizationUpdateSchema.safeParse({
      name: '',
      settings: { defaultCurrency: 'ZZZ', invoiceNextNumber: 0 },
    });
    expect(parsed.success).toBe(false);

    const errors = fieldErrorsFromIssues(parsed.error!.issues);
    expect(errors.name).toMatch(/required/i);
    expect(errors.defaultCurrency).toMatch(/currency/i);
    expect(errors.invoiceNextNumber).toMatch(/at least 1/i);
  });

  it('rejects unknown top-level keys', () => {
    expect(organizationUpdateSchema.safeParse({ name: 'Acme', extra: true }).success).toBe(false);
  });
});

describe('partial saves', () => {
  it('leaves omitted keys untouched instead of clearing them', () => {
    // Regression: an earlier version transformed absent keys to `null`, so
    // saving the branding section silently cleared every other field.
    const parsed = organizationSettingsPatchSchema.parse({ brandName: 'Acme' });
    const patch = settingsPatchFromParsed(parsed);

    expect(patch.clear).toEqual([]);
    expect(patch.set).toEqual({ brandName: 'Acme' });
  });

  it('still clears a field that is explicitly emptied', () => {
    const parsed = organizationSettingsPatchSchema.parse({ brandName: '', city: null });
    const patch = settingsPatchFromParsed(parsed);

    expect(patch.clear.sort()).toEqual(['brandName', 'city']);
    expect(patch.set).toEqual({});
  });
});
