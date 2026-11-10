/**
 * White-label branding maths.
 *
 * The brand colour must be safe (valid hex), readable (WCAG AA in both themes)
 * and narrow in scope: it overrides accent/primary/ring only, so a customer
 * colour can never repaint an error or a status badge.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BRAND_COLOR,
  MIN_TEXT_CONTRAST,
  brandThemeCss,
  contrastRatio,
  ensureContrast,
  normalizeBrandColor,
  normalizeLogoUrl,
  readableForeground,
  resolveBrandName,
  resolveBrandTheme,
} from '@/lib/branding';

describe('normalizeBrandColor', () => {
  it('accepts 3- and 6-digit hex with or without a leading #', () => {
    expect(normalizeBrandColor('#047857')).toBe('#047857');
    expect(normalizeBrandColor('047857')).toBe('#047857');
    expect(normalizeBrandColor('#0af')).toBe('#00aaff');
    expect(normalizeBrandColor('#AABBCC')).toBe('#aabbcc');
  });

  it('rejects everything else', () => {
    for (const value of ['', '   ', 'red', '#12345', 'rgb(1,2,3)', 'javascript:alert(1)', null]) {
      expect(normalizeBrandColor(value as string | null), String(value)).toBeNull();
    }
  });
});

describe('contrast helpers', () => {
  it('matches known WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2);
  });

  it('picks a readable foreground for any accent', () => {
    for (const color of ['#047857', '#facc15', '#1e293b', '#ffffff', '#000000']) {
      expect(contrastRatio(readableForeground(color), color)).toBeGreaterThanOrEqual(4.4);
    }
  });

  it('only darkens a colour when it has to', () => {
    const alreadyReadable = '#047857';
    expect(ensureContrast(alreadyReadable, '#ffffff')).toBe(alreadyReadable);

    const tooLight = '#fde68a';
    const fixed = ensureContrast(tooLight, '#ffffff');
    expect(fixed).not.toBe(tooLight);
    expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});

describe('resolveBrandTheme', () => {
  it('falls back to the default brand theme when no colour is set', () => {
    const theme = resolveBrandTheme(null);
    expect(theme.custom).toBe(false);
    expect(theme.light.accent).toBe(DEFAULT_BRAND_COLOR);
    expect(theme.dark.accent).not.toBe('');
  });

  it('produces readable accents in both themes for any valid colour', () => {
    for (const color of ['#047857', '#7c3aed', '#fbbf24', '#0ea5e9']) {
      const theme = resolveBrandTheme(color);
      expect(theme.custom).toBe(true);
      expect(contrastRatio(theme.light.accent, '#ffffff')).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST
      );
      expect(contrastRatio(theme.dark.accent, '#1e293b')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(
        contrastRatio(theme.light.accentForeground, theme.light.accent)
      ).toBeGreaterThanOrEqual(4.4);
    }
  });
});

describe('brandThemeCss', () => {
  it('overrides only brand tokens, in both themes, and never semantic colours', () => {
    const css = brandThemeCss(resolveBrandTheme('#7c3aed'));

    expect(css).toContain(':root{');
    expect(css).toContain('.dark{');
    expect(css).toContain('--color-accent:');
    expect(css).toContain('--color-primary:');
    expect(css).toContain('--color-ring:');

    for (const forbidden of [
      '--color-destructive',
      '--color-warning',
      '--color-success',
      '--color-danger',
    ]) {
      expect(css).not.toContain(forbidden);
    }
    expect(css).not.toContain('</style');
  });
});

describe('resolveBrandName', () => {
  it('falls back brand name → organization name → product name', () => {
    expect(resolveBrandName('Acme Studio', 'Acme LLC')).toBe('Acme Studio');
    expect(resolveBrandName('   ', 'Acme LLC')).toBe('Acme LLC');
    expect(resolveBrandName(undefined, null)).toBe('AgencyOS');
  });
});

describe('normalizeLogoUrl', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(normalizeLogoUrl('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png'
    );
    expect(normalizeLogoUrl('http://example.com/l.png')).toBe('http://example.com/l.png');
  });

  it('rejects unsafe or relative URLs', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '//example.com/logo.png',
      '/logo.png',
      'ftp://example.com/logo.png',
      '',
      null,
    ]) {
      expect(normalizeLogoUrl(value as string | null), String(value)).toBeNull();
    }
  });
});
