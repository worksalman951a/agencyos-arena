/**
 * Application-shell regression tests.
 *
 * Root cause of the missing sidebar: nine top-level route directories existed
 * but only three had a layout, and those three each carried their own copy of
 * the shell. `/finance/invoices` therefore rendered inside `app/layout.tsx`
 * alone - content, no navigation.
 *
 * These tests lock in the fix: every module delegates to the one shared shell,
 * no page renders navigation itself, and the sidebar highlights the right item.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { filterNavigation, NAV_SECTIONS } from '@/lib/navigation';
import { Sidebar } from '@/components/layout/sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/finance/invoices/abc123',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/** Every top-level area of the app that must render the authenticated shell. */
const MODULES = [
  'admin',
  'automation',
  'crm',
  'dashboard',
  'documents',
  'finance',
  'projects',
  'sales',
  'settings',
];

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(ROOT, relativePath));
}

/** Every .tsx file under a directory, skipping API routes. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'api' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const appSourceFiles = () => sourceFiles(path.join(ROOT, 'app'));
const allUiSourceFiles = () => [
  ...sourceFiles(path.join(ROOT, 'app')),
  ...sourceFiles(path.join(ROOT, 'components')),
];

describe('module layouts', () => {
  it.each(MODULES)('%s has a layout that renders the shared ModuleShell', (module) => {
    const layoutPath = `app/${module}/layout.tsx`;
    expect(exists(layoutPath)).toBe(true);

    const src = read(layoutPath);
    expect(src).toContain("import { ModuleShell } from '@/components/server/module-shell'");
    expect(src).toContain('<ModuleShell>');
    expect(src).toContain("export const dynamic = 'force-dynamic'");
    // Layouts must not re-implement any of the shell themselves.
    expect(src).not.toContain('@/components/layout/sidebar');
    expect(src).not.toContain('@/components/layout/top-nav');
  });

  it('keeps the shell in exactly one place', () => {
    const shellUsers = allUiSourceFiles().filter((file) =>
      read(path.relative(ROOT, file)).includes('<AppShell')
    );

    expect(shellUsers.map((f) => path.relative(ROOT, f))).toEqual([
      path.join('components', 'server', 'module-shell.tsx'),
    ]);
  });

  it('has no second sidebar implementation', () => {
    const importers = allUiSourceFiles().filter((file) =>
      read(path.relative(ROOT, file)).includes('@/components/layout/sidebar')
    );

    expect(importers.map((f) => path.relative(ROOT, f))).toEqual([
      path.join('components', 'layout', 'app-shell.tsx'),
    ]);
  });

  it('never wraps a page in its own header/shell', () => {
    const offenders = appSourceFiles()
      .filter((file) => file.endsWith('page.tsx'))
      .filter((file) => {
        const src = read(path.relative(ROOT, file));
        return src.includes('<AppShell') || src.includes('<Sidebar') || src.includes('<TopNav');
      });

    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('mounts both toast outlets in the shared shell', () => {
    const src = read('components/layout/app-shell.tsx');
    // shadcn-style useToast outlet
    expect(src).toContain("import { Toaster } from '@/components/ui/toaster'");
    // sonner outlet - used by ~20 pages and never mounted before this change
    expect(src).toContain("import { Toaster as SonnerToaster } from 'sonner'");
    expect(src).toContain('<SonnerToaster');
  });

  it('validates the session server-side before rendering children', () => {
    const src = read('components/server/module-shell.tsx');
    expect(src).toContain('getSessionUser');
    expect(src).toContain("redirect('/login')");
    expect(src).toContain('filterNavigation(NAV_SECTIONS, permissions)');
  });
});

describe('Sidebar', () => {
  it('renders grouped navigation and marks the active route', () => {
    const allPermissions = new Set(
      NAV_SECTIONS.flatMap((section) => section.items)
        .map((item) => item.permission)
        .filter((code): code is string => Boolean(code))
    );
    const sections = filterNavigation(NAV_SECTIONS, allPermissions);

    render(<Sidebar sections={sections} isCollapsed={false} setIsCollapsed={() => {}} />);

    expect(screen.getByText('Finance')).toBeInTheDocument();

    const active = screen.getByRole('link', { name: 'Invoices' });
    expect(active).toHaveAttribute('aria-current', 'page');

    const inactive = screen.getByRole('link', { name: 'Contacts' });
    expect(inactive).not.toHaveAttribute('aria-current');

    cleanup();
  });

  it('renders only the sections it is given (permission filtering happens server-side)', () => {
    const sections = filterNavigation(NAV_SECTIONS, new Set(['invoice.read']));

    render(<Sidebar sections={sections} isCollapsed={false} setIsCollapsed={() => {}} />);

    expect(screen.getByRole('link', { name: 'Invoices' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
    expect(screen.queryByText('Administration')).toBeNull();

    cleanup();
  });
});
