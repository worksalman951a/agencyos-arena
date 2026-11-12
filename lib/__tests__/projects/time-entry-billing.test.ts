import { describe, it, expect } from 'vitest';

import {
  computeBillableAmountMinor,
  computeBillableAmountText,
  isValidHourlyRateText,
  isValidHoursText,
  normalizeHourlyRateText,
  summarizeTimeEntries,
} from '@/lib/projects/time-entry-billing';

describe('time-entry-billing helpers', () => {
  it('validates hours and hourly rate strings strictly', () => {
    expect(isValidHoursText('1')).toBe(true);
    expect(isValidHoursText('2.5')).toBe(true);
    expect(isValidHoursText('0.125')).toBe(true);
    expect(isValidHoursText('1000')).toBe(true);
    expect(isValidHoursText('0')).toBe(false);
    expect(isValidHoursText('-1.5')).toBe(false);
    expect(isValidHoursText('1000.01')).toBe(false);
    expect(isValidHoursText('1.12345')).toBe(false);
    expect(isValidHoursText('1e2')).toBe(false);

    expect(isValidHourlyRateText('150')).toBe(true);
    expect(isValidHourlyRateText('150.5')).toBe(true);
    expect(isValidHourlyRateText('150.25')).toBe(true);
    expect(isValidHourlyRateText('0')).toBe(false);
    expect(isValidHourlyRateText('-25')).toBe(false);
    expect(isValidHourlyRateText('150.123')).toBe(false);
    expect(isValidHourlyRateText('1000001')).toBe(false);

    expect(normalizeHourlyRateText('150')).toBe('150.00');
    expect(normalizeHourlyRateText('99.5')).toBe('99.50');
  });

  it('computes billable amounts using exact integer math and half-up rounding', () => {
    expect(computeBillableAmountMinor('2.5', '100.00', true)).toBe(25000);
    expect(computeBillableAmountText('2.5', '100.00', true)).toBe('250.00');

    // Half-up rounding from ten-thousandths: 1.5 * 33.33 = 49.995 -> 50.00
    expect(computeBillableAmountMinor('1.5', '33.33', true)).toBe(5000);
    expect(computeBillableAmountText('1.5', '33.33', true)).toBe('50.00');

    // 4-decimal hours precision
    expect(computeBillableAmountText('0.3333', '100.00', true)).toBe('33.33');

    // Non-billable or rate-less entries return null
    expect(computeBillableAmountText('4.0', '150.00', false)).toBeNull();
    expect(computeBillableAmountText('4.0', null, true)).toBeNull();
  });

  it('summarizes hours without float drift and keeps currencies strictly separated', () => {
    const summary = summarizeTimeEntries([
      { hours: '0.1', billable: true, hourlyRate: '100', currency: 'USD' },
      { hours: '0.2', billable: true, hourlyRate: '100', currency: 'USD' },
      { hours: '1.5', billable: true, hourlyRate: '120.50', currency: 'EUR' },
      { hours: '2.0', billable: true, hourlyRate: null, currency: null },
      { hours: '3.25', billable: false, hourlyRate: null, currency: null },
    ]);

    expect(summary.entryCount).toBe(5);
    expect(summary.totalHours).toBe(7.05);
    expect(summary.billableHours).toBe(3.8);
    expect(summary.nonBillableHours).toBe(3.25);
    expect(summary.ratedBillableEntryCount).toBe(3);
    expect(summary.unratedBillableEntryCount).toBe(1);
    expect(summary.unratedBillableHours).toBe(2);

    expect(summary.billableAmountsByCurrency).toEqual([
      {
        currency: 'EUR',
        amount: '180.75',
        amountMinor: 18075,
        billableHours: 1.5,
        entryCount: 1,
      },
      {
        currency: 'USD',
        amount: '30.00',
        amountMinor: 3000,
        billableHours: 0.3,
        entryCount: 2,
      },
    ]);
  });
});
