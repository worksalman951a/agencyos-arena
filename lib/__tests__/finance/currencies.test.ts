/**
 * Currency helpers.
 *
 * Money is stored and summed in integer minor units; these tests pin that no
 * step introduces floating-point drift and that every currency the settings
 * selector must offer actually resolves.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CURRENCY,
  formatCurrencyAmount,
  formatMinorUnits,
  formatMinorUnitsAsCurrency,
  getCurrency,
  isSupportedCurrency,
  listCurrencies,
  normalizeCurrencyCode,
  parseAmountToMinorUnits,
} from '@/lib/currencies';

describe('listCurrencies', () => {
  it('offers the currencies the settings UI must support', () => {
    const codes = new Set(listCurrencies().map((currency) => currency.code));
    for (const code of ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR']) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it('returns sorted, unique codes with names', () => {
    const currencies = listCurrencies();
    const codes = currencies.map((currency) => currency.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(codes);
    expect(currencies.every((currency) => currency.name.length > 0)).toBe(true);
  });
});

describe('currency validation', () => {
  it('normalizes casing and rejects unknown codes', () => {
    expect(normalizeCurrencyCode('usd')).toBe('USD');
    expect(normalizeCurrencyCode(' pkr ')).toBe('PKR');
    expect(normalizeCurrencyCode('XYZ')).toBeNull();
    expect(normalizeCurrencyCode(null)).toBeNull();
  });

  it('reports support for the default currency and rejects junk', () => {
    expect(isSupportedCurrency(DEFAULT_CURRENCY)).toBe(true);
    expect(isSupportedCurrency('not-a-currency')).toBe(false);
    expect(getCurrency('usd')?.code).toBe('USD');
    expect(getCurrency('XYZ')).toBeUndefined();
  });
});

describe('parseAmountToMinorUnits', () => {
  it('parses decimal strings exactly, without binary drift', () => {
    expect(parseAmountToMinorUnits('19.99')).toBe(1999);
    expect(parseAmountToMinorUnits('0.1')).toBe(10);
    expect(parseAmountToMinorUnits('0.2')).toBe(20);
    expect(parseAmountToMinorUnits('1234.5')).toBe(123450);
    expect(parseAmountToMinorUnits('1000')).toBe(100000);
    expect(parseAmountToMinorUnits(19.99)).toBe(1999);
  });

  it('handles negatives, blanks and rounding half-up', () => {
    expect(parseAmountToMinorUnits('-3.05')).toBe(-305);
    expect(parseAmountToMinorUnits('')).toBe(0);
    expect(parseAmountToMinorUnits(null)).toBe(0);
    expect(parseAmountToMinorUnits('1.005')).toBe(101);
    expect(parseAmountToMinorUnits('1.004')).toBe(100);
  });

  it('supports currencies with zero decimal places', () => {
    expect(parseAmountToMinorUnits('1500', 0)).toBe(1500);
    expect(formatMinorUnits(1500, 0)).toBe('1500');
  });
});

describe('formatting', () => {
  it('round-trips minor units through the decimal string form', () => {
    for (const amount of ['0', '1', '19.99', '1234.50', '-3.05']) {
      expect(formatMinorUnits(parseAmountToMinorUnits(amount))).toBe(
        amount.includes('.') ? amount : `${amount}.00`
      );
    }
  });

  it('formats integer minor units as currency without a float step', () => {
    expect(formatMinorUnitsAsCurrency(123450, 'USD')).toContain('1,234.50');
    expect(formatMinorUnitsAsCurrency(0, 'PKR')).toMatch(/0/);
  });

  it('falls back safely for an unsupported currency code', () => {
    const formatted = formatCurrencyAmount('10.00', 'XYZ');
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
});
