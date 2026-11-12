import { describe, it, expect } from 'vitest';
import { sumDecimalAmounts, formatDecimalMoney } from '@/lib/finance/decimal-utils';

describe('Sales Financial Precision: Decimal-safe Aggregation', () => {
  it('sums multiple decimal amounts without floating-point drift', () => {
    // Classic 0.1 + 0.2 problem
    const amounts = ['0.10', '0.20'];
    expect(sumDecimalAmounts(amounts)).toBe('0.30');

    // High precision values
    const lineItems = ['19999.99', '0.01', '5000.50'];
    expect(sumDecimalAmounts(lineItems)).toBe('25000.50');
  });

  it('safely handles null, undefined, and non-numeric entries', () => {
    const mixed = ['100.00', null, undefined, '', 'abc', '50.25'];
    expect(sumDecimalAmounts(mixed)).toBe('150.25');
  });

  it('formats decimal money with correct commas and fixed two decimals', () => {
    expect(formatDecimalMoney('1250000.5')).toBe('1,250,000.50');
    expect(formatDecimalMoney('0')).toBe('0.00');
    expect(formatDecimalMoney(null)).toBe('0.00');
    expect(formatDecimalMoney(undefined)).toBe('0.00');
  });
});
