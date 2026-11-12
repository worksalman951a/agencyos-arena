/**
 * Pure time-entry billing calculations and multi-currency summary helpers.
 *
 * Arithmetic uses exact scaled integers (`10_000`ths for hours, integer minor
 * units for money) so floating-point precision drift cannot affect hours or
 * billable totals, and distinct currencies are never merged or converted.
 */

import {
  DEFAULT_CURRENCY,
  formatMinorUnits,
  normalizeCurrencyCode,
  parseAmountToMinorUnits,
} from '@/lib/currencies';

const DECIMAL_HOURS_PATTERN = /^\d+(?:\.\d{1,4})?$/;
const DECIMAL_RATE_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export interface CurrencyAmountSummary {
  currency: string;
  amount: string;
  amountMinor: number;
  billableHours: number;
  entryCount: number;
}

export interface TimeEntrySummary {
  entryCount: number;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  ratedBillableEntryCount: number;
  unratedBillableEntryCount: number;
  unratedBillableHours: number;
  billableAmountsByCurrency: CurrencyAmountSummary[];
}

export interface TimeEntrySummaryInput {
  hours: { toString: () => string } | string | number;
  billable: boolean;
  hourlyRate?: { toString: () => string } | string | number | null;
  currency?: string | null;
}

function roundHoursFromTenThousandths(tenThousandths: number): number {
  return Number((tenThousandths / 10000).toFixed(2));
}

export function isValidHoursText(value: string): boolean {
  const trimmed = value.trim();
  if (!DECIMAL_HOURS_PATTERN.test(trimmed)) return false;
  const tenThousandths = parseAmountToMinorUnits(trimmed, 4);
  return tenThousandths > 0 && tenThousandths <= 1000 * 10000;
}

export function isValidHourlyRateText(value: string): boolean {
  const trimmed = value.trim();
  if (!DECIMAL_RATE_PATTERN.test(trimmed)) return false;
  const minor = parseAmountToMinorUnits(trimmed, 2);
  return minor > 0 && minor <= 1_000_000 * 100;
}

/**
 * Normalize an hourly rate string to canonical 2-decimal text (e.g. "150" -> "150.00").
 */
export function normalizeHourlyRateText(value: string): string {
  const minor = parseAmountToMinorUnits(value.trim(), 2);
  return formatMinorUnits(minor, 2);
}

/**
 * Compute exact billable amount in integer minor units for one time entry.
 * Uses BigInt multiplication + half-up rounding from ten-thousandths of an hour.
 */
export function computeBillableAmountMinor(
  hours: { toString: () => string } | string | number,
  hourlyRate: { toString: () => string } | string | number | null | undefined,
  billable: boolean
): number | null {
  if (!billable || hourlyRate === null || hourlyRate === undefined) {
    return null;
  }

  const rateStr =
    typeof hourlyRate === 'number' ? hourlyRate.toString() : hourlyRate.toString().trim();
  if (!rateStr) return null;

  const hoursStr = typeof hours === 'number' ? hours.toString() : hours.toString().trim();
  const hoursTenThousandths = parseAmountToMinorUnits(hoursStr, 4);
  const rateMinor = parseAmountToMinorUnits(rateStr, 2);

  if (hoursTenThousandths <= 0 || rateMinor <= 0) {
    return null;
  }

  const wholeHours = Math.trunc(hoursTenThousandths / 10000);
  const fracHours = hoursTenThousandths % 10000;
  const wholeMinor = wholeHours * rateMinor;
  const fracMinor = Math.trunc((fracHours * rateMinor + 5000) / 10000);
  return wholeMinor + fracMinor;
}

export function computeBillableAmountText(
  hours: { toString: () => string } | string | number,
  hourlyRate: { toString: () => string } | string | number | null | undefined,
  billable: boolean
): string | null {
  const minor = computeBillableAmountMinor(hours, hourlyRate, billable);
  return minor === null ? null : formatMinorUnits(minor, 2);
}

/**
 * Aggregate hours and per-currency billable totals over a list of time entries.
 * Distinct currencies remain strictly separated.
 */
export function summarizeTimeEntries(entries: readonly TimeEntrySummaryInput[]): TimeEntrySummary {
  let totalTenThousandths = 0;
  let billableTenThousandths = 0;
  let ratedBillableEntryCount = 0;
  let unratedBillableEntryCount = 0;
  let unratedBillableTenThousandths = 0;

  const currencyMap = new Map<
    string,
    { amountMinor: number; hoursTenThousandths: number; entryCount: number }
  >();

  for (const entry of entries) {
    const hoursStr =
      typeof entry.hours === 'number' ? entry.hours.toString() : entry.hours.toString().trim();
    const hoursTenThousandths = parseAmountToMinorUnits(hoursStr, 4);
    if (!Number.isFinite(hoursTenThousandths) || hoursTenThousandths < 0) continue;

    totalTenThousandths += hoursTenThousandths;

    if (!entry.billable) continue;
    billableTenThousandths += hoursTenThousandths;

    const amountMinor = computeBillableAmountMinor(hoursStr, entry.hourlyRate, true);
    if (amountMinor === null) {
      unratedBillableEntryCount += 1;
      unratedBillableTenThousandths += hoursTenThousandths;
      continue;
    }

    ratedBillableEntryCount += 1;
    const currency = normalizeCurrencyCode(entry.currency) ?? DEFAULT_CURRENCY;
    const prev = currencyMap.get(currency) ?? {
      amountMinor: 0,
      hoursTenThousandths: 0,
      entryCount: 0,
    };
    prev.amountMinor += amountMinor;
    prev.hoursTenThousandths += hoursTenThousandths;
    prev.entryCount += 1;
    currencyMap.set(currency, prev);
  }

  const billableAmountsByCurrency: CurrencyAmountSummary[] = [...currencyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, bucket]) => ({
      currency,
      amount: formatMinorUnits(bucket.amountMinor, 2),
      amountMinor: bucket.amountMinor,
      billableHours: roundHoursFromTenThousandths(bucket.hoursTenThousandths),
      entryCount: bucket.entryCount,
    }));

  const nonBillableTenThousandths = Math.max(0, totalTenThousandths - billableTenThousandths);

  return {
    entryCount: entries.length,
    totalHours: roundHoursFromTenThousandths(totalTenThousandths),
    billableHours: roundHoursFromTenThousandths(billableTenThousandths),
    nonBillableHours: roundHoursFromTenThousandths(nonBillableTenThousandths),
    ratedBillableEntryCount,
    unratedBillableEntryCount,
    unratedBillableHours: roundHoursFromTenThousandths(unratedBillableTenThousandths),
    billableAmountsByCurrency,
  };
}
