import Decimal from 'decimal.js';

/**
 * Safely sums an array of financial string/number amounts using Decimal precision.
 * Returns the formatted two-decimal string, e.g. "12500.50".
 */
export function sumDecimalAmounts(amounts: Array<string | number | null | undefined>): string {
  let acc = new Decimal(0);
  for (const amt of amounts) {
    if (amt === null || amt === undefined) continue;
    const str = String(amt).trim();
    if (!str) continue;
    try {
      const d = new Decimal(str);
      if (!d.isNaN() && d.isFinite()) {
        acc = acc.plus(d);
      }
    } catch {
      // Ignore invalid representations safely
    }
  }
  return acc.toFixed(2);
}

/**
 * Formats a decimal amount string or number with thousands separators and 2 decimal places.
 */
export function formatDecimalMoney(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return '0.00';
  const str = String(amount).trim();
  if (!str) return '0.00';
  try {
    const d = new Decimal(str);
    if (d.isNaN() || !d.isFinite()) return '0.00';
    return d.toNumber().toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return '0.00';
  }
}
