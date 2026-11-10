/**
 * AgencyOS currency dataset and money formatting.
 *
 * The list of ISO 4217 codes comes from the runtime's ICU data via
 * `Intl.supportedValuesOf('currency')` and the display names from
 * `Intl.DisplayNames` — a maintained dataset with no dependency to install and
 * no list to keep in sync by hand. It includes PKR, USD, EUR, GBP, AED and SAR
 * plus every other ISO currency.
 *
 * Money is handled in integer minor units ("cents") everywhere. Floating point
 * is never used for arithmetic: amounts arrive as strings from the database
 * (Prisma Decimal / NUMERIC) or from forms, and are parsed digit by digit.
 */

/** Currencies that should always be offered even if ICU were to omit them. */
const REQUIRED_CODES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR'] as const;

export const DEFAULT_CURRENCY = 'USD';

export interface CurrencyOption {
  /** ISO 4217 alphabetic code, e.g. "PKR". */
  code: string;
  /** Localized name, e.g. "Pakistani Rupee". */
  name: string;
  /** Symbol, e.g. "₨". Falls back to the code when ICU has no narrow symbol. */
  symbol: string;
}

let cachedOptions: CurrencyOption[] | null = null;

function safeSupportedCurrencies(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'currency') => string[];
  };
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      return intl.supportedValuesOf('currency');
    } catch {
      /* fall through to the static list */
    }
  }
  return [...REQUIRED_CODES];
}

function safeDisplayNames(): Intl.DisplayNames | null {
  if (typeof Intl.DisplayNames !== 'function') return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch {
    return null;
  }
}

function currencyName(code: string, displayNames: Intl.DisplayNames | null): string {
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

/** All supported ISO currencies, sorted by code. */
export function listCurrencies(): CurrencyOption[] {
  if (cachedOptions) return cachedOptions;

  const displayNames = safeDisplayNames();
  const codes = new Set<string>([...safeSupportedCurrencies(), ...REQUIRED_CODES]);

  cachedOptions = [...codes]
    .filter((code) => /^[A-Z]{3}$/.test(code))
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({
      code,
      name: currencyName(code, displayNames),
      symbol: currencySymbol(code),
    }));

  return cachedOptions;
}

const CURRENCY_CODE_SET = new Set(listCurrencies().map((option) => option.code));

/** Is `code` a supported ISO 4217 code (case-insensitive)? */
export function isSupportedCurrency(code: string): boolean {
  return CURRENCY_CODE_SET.has(code.trim().toUpperCase());
}

/** Normalize a user-supplied currency code, or return null when invalid. */
export function normalizeCurrencyCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  return isSupportedCurrency(normalized) ? normalized : null;
}

/** Look up a currency option, or undefined when unsupported. */
export function getCurrency(code: string): CurrencyOption | undefined {
  const normalized = normalizeCurrencyCode(code);
  if (!normalized) return undefined;
  return listCurrencies().find((option) => option.code === normalized);
}

/**
 * Parse a decimal amount (`"1234.5"`, `"-3"`, `1200`) into integer minor units.
 *
 * Digits are handled as text so `19.99` cannot suffer binary floating point
 * drift. Extra decimal places are rounded half-up to the currency's precision.
 */
export function parseAmountToMinorUnits(
  value: string | number | null | undefined,
  fractionDigits = 2
): number {
  if (value === null || value === undefined) return 0;
  const raw = typeof value === 'number' ? value.toString() : value.trim();
  if (!raw) return 0;

  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match) {
    const fallback = Number(raw);
    return Number.isFinite(fallback) ? Math.round(fallback * 10 ** fractionDigits) : 0;
  }

  const [, sign, whole = '0', fraction = ''] = match;
  const padded = (fraction + '0'.repeat(fractionDigits + 1)).slice(0, fractionDigits + 1);
  const kept = padded.slice(0, fractionDigits);
  const nextDigit = Number(padded[fractionDigits] ?? '0');

  let minor = Number(whole || '0') * 10 ** fractionDigits + Number(kept || '0');
  if (nextDigit >= 5) minor += 1;

  return sign === '-' ? -minor : minor;
}

/** Render integer minor units as a plain decimal string (`"1234.50"`). */
export function formatMinorUnits(minorUnits: number, fractionDigits = 2): string {
  const factor = 10 ** fractionDigits;
  const negative = minorUnits < 0;
  const absolute = Math.abs(minorUnits);
  const whole = Math.trunc(absolute / factor);
  const fraction = String(absolute % factor).padStart(fractionDigits, '0');
  return `${negative ? '-' : ''}${whole}${fractionDigits > 0 ? `.${fraction}` : ''}`;
}

/**
 * Format integer minor units as a currency string (`123450` → `$1,234.50`).
 * Kept separate from `formatCurrencyAmount` so callers never convert money to
 * a float on the way to display.
 */
export function formatMinorUnitsAsCurrency(
  minorUnits: number,
  currency: string,
  fractionDigits = 2
): string {
  return formatCurrencyAmount(formatMinorUnits(minorUnits, fractionDigits), currency);
}

/**
 * Format an amount for display in a given currency.
 *
 * Falls back to `<CODE> <amount>` when the runtime cannot format the code, so a
 * malformed or unsupported currency never breaks a page.
 */
export function formatCurrencyAmount(
  amount: string | number | null | undefined,
  currency: string
): string {
  const code = normalizeCurrencyCode(currency) ?? DEFAULT_CURRENCY;
  const numeric = typeof amount === 'number' ? amount : Number(amount ?? 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;

  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).format(safe);
  } catch {
    return `${code} ${safe.toFixed(2)}`;
  }
}
