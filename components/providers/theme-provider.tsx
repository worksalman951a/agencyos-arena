'use client';

import * as React from 'react';

type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'agencyos-theme';

function subscribeThemeStorage(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getClientStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY) as Theme | null;
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function subscribeMediaQuery(callback: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getClientSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // useSyncExternalStore initializes to 'system' on server snapshot, and reads storage on client snapshot without hydration mismatch
  const storedTheme: Theme = React.useSyncExternalStore(
    subscribeThemeStorage,
    getClientStoredTheme,
    () => 'system'
  );

  const systemTheme: 'light' | 'dark' = React.useSyncExternalStore(
    subscribeMediaQuery,
    getClientSystemTheme,
    () => 'light'
  );

  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const [themeOverride, setThemeOverride] = React.useState<Theme | null>(null);

  const theme: Theme = themeOverride ?? storedTheme;
  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? systemTheme : theme;

  React.useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme, mounted]);

  const setTheme = (next: Theme) => {
    setThemeOverride(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, mounted, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

const ThemeContext = React.createContext<{
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  mounted: boolean;
  setTheme: (t: Theme) => void;
}>({ theme: 'system', resolvedTheme: 'light', mounted: false, setTheme: () => {} });

export function useTheme() {
  return React.useContext(ThemeContext);
}
