import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ThemeProvider, useTheme } from '@/components/providers/theme-provider';
import { brandThemeCss, resolveBrandTheme } from '@/lib/branding';

function TestThemeConsumer() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button onClick={() => setTheme('light')}>Set Light</button>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('system')}>Set System</button>
    </div>
  );
}

describe('Phase 13D: Theme Controls & Branding Token Synchronization', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
  });

  describe('ThemeProvider (Light / Dark / System)', () => {
    it('initializes and toggles between light, dark, and system modes', () => {
      render(
        <ThemeProvider>
          <TestThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme').textContent).toBe('system');

      act(() => {
        fireEvent.click(screen.getByText('Set Dark'));
      });
      expect(screen.getByTestId('current-theme').textContent).toBe('dark');
      expect(screen.getByTestId('resolved-theme').textContent).toBe('dark');
      expect(localStorage.getItem('agencyos-theme')).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      act(() => {
        fireEvent.click(screen.getByText('Set Light'));
      });
      expect(screen.getByTestId('current-theme').textContent).toBe('light');
      expect(screen.getByTestId('resolved-theme').textContent).toBe('light');
      expect(localStorage.getItem('agencyos-theme')).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('brandThemeCss Token Injections', () => {
    it('injects both Tailwind and Bento tokens for Emerald (#047857)', () => {
      const theme = resolveBrandTheme('#047857');
      const css = brandThemeCss(theme);

      // Tailwind variables
      expect(css).toContain('--color-accent:#047857');
      expect(css).toContain('--color-primary:#047857');
      // Premium Bento tokens
      expect(css).toContain('--pm-accent:#047857');
      expect(css).toContain('--pm-accent-soft:');
      expect(css).toContain('--pm-accent-ink:');
    });

    it('injects both Tailwind and Bento tokens for Slate (#475569)', () => {
      const theme = resolveBrandTheme('#475569');
      const css = brandThemeCss(theme);

      expect(css).toContain('--color-accent:#475569');
      expect(css).toContain('--color-primary:#475569');
      expect(css).toContain('--pm-accent:#475569');
      expect(css).toContain('--pm-accent-soft:');
      expect(css).toContain('--pm-accent-ink:');
    });

    it('targets both .dark and [data-theme="dark"] for full Bento coverage', () => {
      const theme = resolveBrandTheme('#475569');
      const css = brandThemeCss(theme);

      expect(css).toContain(':root{');
      expect(css).toContain(".dark,[data-theme='dark']{");
    });
  });
});
