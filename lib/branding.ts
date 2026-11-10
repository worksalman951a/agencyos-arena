/**
 * AgencyOS white-label branding maths.
 *
 * The organisation's Brand Color is applied by overriding a small, explicit set
 * of design tokens (accent / primary / ring and their foregrounds) in both the
 * light and dark themes. Everything else — destructive, warning, success, muted,
 * border — is deliberately left alone: a customer brand colour must never
 * recolour an error state or a status badge.
 *
 * The chosen colour is adjusted only as far as necessary to keep text readable
 * against the page background (WCAG AA, 4.5:1), so a very light brand colour
 * still produces legible links instead of invisible ones.
 *
 * Pure functions only: no React, no DOM. Unit tested in
 * lib/__tests__/branding/branding.test.ts.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Background colours the accent must remain readable against. */
const CANVAS = { light: '#ffffff', dark: '#1e293b' } as const;

/** WCAG AA minimum contrast for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;

/** Default AgencyOS accent, used when the organization sets no brand colour. */
export const DEFAULT_BRAND_COLOR = '#047857';

/** Matches `#rgb` or `#rrggbb` (the leading `#` is optional). */
const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Validate and normalize a brand colour to `#rrggbb` (lower case).
 * Returns null for anything that is not a hex colour.
 */
export function normalizeBrandColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!HEX_PATTERN.test(trimmed)) return null;

  const hex = trimmed.replace('#', '').toLowerCase();
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex;

  return `#${expanded}`;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeBrandColor(hex);
  if (!normalized) throw new Error(`Invalid hex colour: ${hex}`);
  const value = normalized.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours (1 → 21). */
export function contrastRatio(a: string, b: string): number {
  const luminanceA = relativeLuminance(hexToRgb(a));
  const luminanceB = relativeLuminance(hexToRgb(b));
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Black or white — whichever contrasts more with `background`.
 * Both candidates are guaranteed ≥ 4.5:1 for any mid-tone accent because one of
 * them is always the extreme; the few remaining cases are covered by
 * `ensureContrast` adjusting the accent itself.
 */
export function readableForeground(background: string): '#ffffff' | '#111827' {
  const white = contrastRatio('#ffffff', background);
  const ink = contrastRatio('#111827', background);
  return white >= ink ? '#ffffff' : '#111827';
}

/** Blend `color` towards `target` by `weight` (0..1). */
function mix(color: string, target: string, weight: number): string {
  const from = hexToRgb(color);
  const to = hexToRgb(target);
  return rgbToHex({
    r: from.r + (to.r - from.r) * weight,
    g: from.g + (to.g - from.g) * weight,
    b: from.b + (to.b - from.b) * weight,
  });
}

/**
 * Move `color` towards `towards` until it reaches `minimum` contrast with
 * `background`. Returns the original colour when it already passes, and the
 * closest achievable colour otherwise (bounded search, no infinite loops).
 */
export function ensureContrast(
  color: string,
  background: string,
  minimum = MIN_TEXT_CONTRAST,
  towards: 'black' | 'white' = 'black'
): string {
  if (contrastRatio(color, background) >= minimum) return color;

  const target = towards === 'black' ? '#000000' : '#ffffff';
  for (let step = 1; step <= 50; step++) {
    const candidate = mix(color, target, step / 50);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}

export interface BrandTheme {
  /** Whether an organization brand colour was applied. */
  custom: boolean;
  light: {
    accent: string;
    accentForeground: string;
    ring: string;
  };
  dark: {
    accent: string;
    accentForeground: string;
    ring: string;
  };
}

/**
 * Resolve the CSS custom property values for an organization's brand colour.
 *
 * `primary` deliberately mirrors `accent` (AgencyOS uses one brand colour) and
 * semantic colours are untouched by design.
 */
export function resolveBrandTheme(brandColor: string | null | undefined): BrandTheme {
  const normalized = normalizeBrandColor(brandColor);

  if (!normalized) {
    return {
      custom: false,
      light: {
        accent: DEFAULT_BRAND_COLOR,
        accentForeground: readableForeground(DEFAULT_BRAND_COLOR),
        ring: DEFAULT_BRAND_COLOR,
      },
      dark: {
        accent: '#10b981',
        accentForeground: readableForeground('#10b981'),
        ring: '#10b981',
      },
    };
  }

  const lightAccent = ensureContrast(normalized, CANVAS.light, MIN_TEXT_CONTRAST, 'black');
  const darkAccent = ensureContrast(normalized, CANVAS.dark, MIN_TEXT_CONTRAST, 'white');

  return {
    custom: true,
    light: {
      accent: lightAccent,
      accentForeground: readableForeground(lightAccent),
      ring: lightAccent,
    },
    dark: {
      accent: darkAccent,
      accentForeground: readableForeground(darkAccent),
      ring: darkAccent,
    },
  };
}

/**
 * Inline style string for the two themes.
 *
 * Scoped to `:root`/`.dark` and limited to the tokens above; the rules are
 * emitted after the compiled stylesheet so they win for equal specificity.
 */
export function brandThemeCss(theme: BrandTheme): string {
  const vars = (tone: BrandTheme['light']) =>
    [
      `--color-accent:${tone.accent};`,
      `--color-accent-foreground:${tone.accentForeground};`,
      `--color-primary:${tone.accent};`,
      `--color-primary-foreground:${tone.accentForeground};`,
      `--color-ring:${tone.ring};`,
    ].join('');

  return `:root{${vars(theme.light)}}.dark{${vars(theme.dark)}}`;
}

/**
 * Brand name for customer-facing surfaces: Brand Name, else the organization
 * name, else the product name.
 */
export function resolveBrandName(
  brandName: string | null | undefined,
  organizationName: string | null | undefined
): string {
  const brand = brandName?.trim();
  if (brand) return brand;
  const org = organizationName?.trim();
  if (org) return org;
  return 'AgencyOS';
}

/**
 * Validate a logo URL: absolute http(s) only (no `javascript:`, `data:` or
 * protocol-relative URLs), which is also what `next/image`/`<img>` need.
 */
export function normalizeLogoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return trimmed;
}
