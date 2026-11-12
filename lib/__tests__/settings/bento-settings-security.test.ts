import { describe, it, expect } from 'vitest';

import {
  organizationSettingsPatchSchema,
  normalizeOrganizationSettings,
  fieldErrorsFromIssues,
} from '@/lib/schemas/settings/organization.schema';
import { formatDocumentNumber } from '@/lib/services/settings/document-number-format';

describe('Phase 8B Settings, Branding & Feature Flag Security & Integrity', () => {
  it('enforces organization settings schema validation: rejects invalid hex brand color', () => {
    const parsed = organizationSettingsPatchSchema.safeParse({
      brandColor: 'not-a-color',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = fieldErrorsFromIssues(parsed.error.issues);
      expect(errors.brandColor).toBeDefined();
    }
  });

  it('enforces organization settings schema validation: accepts valid hex brand color and normalizes it', () => {
    const parsed = organizationSettingsPatchSchema.safeParse({
      brandColor: '#047857',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.brandColor).toBe('#047857');
    }
  });

  it('enforces organization settings schema validation: rejects non-http/https logoUrl', () => {
    const parsed = organizationSettingsPatchSchema.safeParse({
      logoUrl: 'javascript:alert(1)',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = fieldErrorsFromIssues(parsed.error.issues);
      expect(errors.logoUrl).toBeDefined();
    }
  });

  it('enforces organization settings schema validation: rejects invalid email format in contactEmail', () => {
    const parsed = organizationSettingsPatchSchema.safeParse({
      contactEmail: 'invalid-email-address',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = fieldErrorsFromIssues(parsed.error.issues);
      expect(errors.contactEmail).toBeDefined();
    }
  });

  it('enforces prefix constraints: forces uppercase and prevents invalid symbols', () => {
    const parsed = organizationSettingsPatchSchema.safeParse({
      invoiceNumberPrefix: 'inv-corp',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.invoiceNumberPrefix).toBe('INV-CORP');
    }

    const invalid = organizationSettingsPatchSchema.safeParse({
      invoiceNumberPrefix: 'INV@CORP#',
    });
    expect(invalid.success).toBe(false);
  });

  it('preserves document numbering format semantics (PREFIX-YYYY-NNNN)', () => {
    const formatted = formatDocumentNumber('INV', 42, 2026);
    expect(formatted).toBe('INV-2026-0042');

    const formattedLarge = formatDocumentNumber('PRP', 12345, 2026);
    expect(formattedLarge).toBe('PRP-2026-12345');
  });

  it('normalizes organization settings safely when column is null or malformed', () => {
    const normalized = normalizeOrganizationSettings(null);
    expect(normalized.defaultCurrency).toBe('USD');
    expect(normalized.dateFormat).toBe('MM/DD/YYYY');
    expect(normalized.invoiceNumberPrefix).toBe('INV');
    expect(normalized.invoiceNextNumber).toBe(1);
    expect(normalized.proposalNumberPrefix).toBe('PRP');
    expect(normalized.proposalNextNumber).toBe(1);

    const malformed = normalizeOrganizationSettings({
      defaultCurrency: 'FAKE_COIN',
      invoiceNextNumber: -99,
    });
    expect(malformed.defaultCurrency).toBe('USD');
    expect(malformed.invoiceNextNumber).toBe(1);
  });
});
