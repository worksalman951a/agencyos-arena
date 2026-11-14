/**
 * Bento sidebar behaviour tests.
 *
 * These lock in the interaction contract the design review asked for:
 * - Today is an emerald pill only while the dashboard is active.
 * - The active sub-item is highlighted and its parent stays expanded.
 * - One subtle divider separates Billing & Invoices from Automations.
 * - The expand/collapse control is a real button outside the link (keyboard reachable).
 * - Collapsed desktop mode hides labels/sub-menus; the mobile drawer exposes them.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { filterNavigation, NAV_SECTIONS } from '@/lib/navigation';
import { BentoAppShell } from '@/components/layout/bento-app-shell';

let mockPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/components/providers/theme-provider', () => ({
  useTheme: () => ({
    theme: 'light',
    resolvedTheme: 'light',
    mounted: true,
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn() }));

const allPermissions = new Set(
  NAV_SECTIONS.flatMap((section) => [
    section.items.map((item) => item.permission),
    section.items.flatMap((item) => item.subItems?.map((sub) => sub.permission) ?? []),
  ])
    .flat()
    .filter((code): code is string => Boolean(code))
);

function renderShell() {
  return render(
    <BentoAppShell
      user={{ id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' }}
      sections={filterNavigation(NAV_SECTIONS, allPermissions)}
      branding={null}
    >
      <div>page body</div>
    </BentoAppShell>
  );
}

function nav() {
  return screen.getByRole('complementary', { name: 'Main navigation' });
}

beforeEach(() => {
  mockPathname = '/dashboard';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, json: async () => ({}) }))
  );
});

describe('Bento sidebar', () => {
  it('renders Today as an emerald pill only when the dashboard is active', async () => {
    const user = userEvent.setup();
    renderShell();

    const today = within(nav()).getByRole('link', { name: 'Today' });
    expect(today).toHaveAttribute('href', '/dashboard');
    expect(today).toHaveAttribute('data-variant', 'emerald');
    expect(today).toHaveAttribute('aria-current', 'page');

    // Expanding a group does not move the dashboard highlight.
    await user.click(within(nav()).getByRole('button', { name: 'Expand Automations submenu' }));
    expect(within(nav()).getByRole('link', { name: 'Workflow Rules' })).toBeVisible();
    expect(within(nav()).getByRole('link', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('highlights the active submenu and keeps its parent expanded', () => {
    mockPathname = '/finance/invoices/abc123';
    renderShell();

    const invoices = within(nav()).getByRole('link', { name: 'Invoices' });
    expect(invoices).toHaveAttribute('aria-current', 'page');
    expect(invoices).toHaveAttribute('href', '/finance/invoices');

    const parent = within(nav()).getByRole('link', { name: 'Billing & Invoices' });
    expect(parent).toHaveAttribute('data-active', 'true');
    expect(parent).not.toHaveAttribute('aria-current');

    expect(
      within(nav()).getByRole('button', { name: 'Collapse Billing & Invoices submenu' })
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(nav()).getByRole('group', { name: 'Billing & Invoices sub-items' })
    ).toBeInTheDocument();
  });

  it('does not highlight a fragment panel that is not selected', () => {
    mockPathname = '/settings';
    renderShell();

    expect(within(nav()).getByRole('link', { name: 'Agency Settings' })).toHaveAttribute(
      'data-active',
      'true'
    );
    expect(within(nav()).getByRole('link', { name: 'Workspace Branding' })).not.toHaveAttribute(
      'aria-current'
    );
    expect(within(nav()).getByRole('link', { name: 'Invoice Numbering' })).not.toHaveAttribute(
      'aria-current'
    );
  });

  it('renders one subtle divider between Billing & Invoices and Automations', () => {
    renderShell();

    const separators = nav().querySelectorAll('[role="separator"]');
    expect(separators).toHaveLength(1);

    const divider = separators[0];
    expect(divider.className).toContain('ps-divider');
    const order = within(nav())
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(order.indexOf('Billing & Invoices')).toBeLessThan(order.indexOf('Automations'));
  });

  it('keeps the submenu toggle outside the link and operable from the keyboard', async () => {
    const user = userEvent.setup();
    renderShell();

    const toggle = within(nav()).getByRole('button', { name: 'Expand Automations submenu' });
    expect(toggle.closest('a')).toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls');

    toggle.focus();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav()).getByRole('link', { name: 'Reminders & Alerts' })).toBeVisible();

    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav()).queryByRole('link', { name: 'Reminders & Alerts' })).toBeNull();
  });

  it('collapses to an icon rail without labels or sub-menus', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(within(nav()).getByRole('button', { name: 'Collapse sidebar' }));

    const sidebar = nav();
    expect(sidebar).toHaveAttribute('data-mode', 'compact');
    expect(within(sidebar).getByRole('link', { name: 'Today' })).toHaveAttribute('title', 'Today');
    expect(within(sidebar).queryByRole('link', { name: 'Invoices' })).toBeNull();
    expect(within(sidebar).queryByRole('button', { name: /submenu/ })).toBeNull();
    // Every destination is still reachable as an icon link with an accessible name.
    expect(within(sidebar).getByRole('link', { name: 'Billing & Invoices' })).toBeVisible();
  });

  it('opens and closes the mobile drawer', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Toggle navigation drawer' }));
    expect(nav()).toHaveAttribute('data-mobile-open', 'true');

    mockPathname = '/finance/invoices';
    // Navigating from the drawer closes it.
    await user.click(within(nav()).getByRole('link', { name: 'Reports' }));
    expect(nav()).not.toHaveAttribute('data-mobile-open');

    await user.click(screen.getByRole('button', { name: 'Toggle navigation drawer' }));
    expect(nav()).toHaveAttribute('data-mobile-open', 'true');

    await user.keyboard('{Escape}');
    expect(nav()).not.toHaveAttribute('data-mobile-open');
  });
});
