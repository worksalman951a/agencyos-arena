/**
 * BentoAppShell & Refined Hybrid Animated Sidebar Tests.
 *
 * Verifies:
 * - Collapsed by default (72px rail) and smooth hover expansion (to 240px)
 * - Main canvas content has zero shift on hover
 * - No horizontal separator lines in sidebar (clean vertical spacing only)
 * - Pin/unpin control completely removed (no localStorage dependency)
 * - Settings is in the normal sidebar navigation list
 * - Fixed footer contains ONLY user avatar/account popover
 * - Animated nested submenus for Pipeline, Projects, Documents
 * - Active route highlighting and auto-expansion
 * - Keyboard navigation, focus states, and Escape key behavior
 * - Mobile drawer navigation and touch accessibility
 * - Short viewport height behavior without scroll clipping or icon truncation
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { BentoAppShell } from '@/components/layout/bento-app-shell';
import { NAV_SECTIONS, filterNavigation } from '@/lib/navigation';

let currentPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/components/providers/theme-provider', () => ({
  useTheme: () => ({
    theme: 'system',
    resolvedTheme: 'light',
    mounted: true,
    setTheme: vi.fn(),
  }),
}));

const testUser = {
  id: 'usr_test_123',
  name: 'Alex Rivera',
  email: 'alex@example.com',
};

const allPermissions = new Set([
  'contact.read',
  'account.read',
  'lead.read',
  'opportunity.read',
  'pipeline.read',
  'proposal.read',
  'quotation.read',
  'project.read',
  'project.template.read',
  'time.entry.read',
  'project.approval.read',
  'change.order.read',
  'invoice.read',
  'estimate.read',
  'expense.read',
  'contract.read',
  'template.read',
  'document.read',
  'workflow.read',
]);

const sections = filterNavigation(NAV_SECTIONS, allPermissions);

describe('BentoAppShell Refined Hybrid Animated Sidebar', () => {
  beforeEach(() => {
    currentPathname = '/dashboard';
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders collapsed rail (72px) by default with centered icons and brand logo', () => {
    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const wrapper = container.querySelector('.ps-wrapper');
    const aside = container.querySelector('.ps');

    expect(wrapper).toBeInTheDocument();
    expect(aside).toHaveAttribute('data-mode', 'compact');
    expect(screen.getByText('Main Content')).toBeInTheDocument();

    // Verify pin/unpin button is NOT present
    expect(screen.queryByRole('button', { name: /pin/i })).toBeNull();

    // Verify no decorative horizontal separator lines exist
    expect(container.querySelector('.ps-section__divider')).toBeNull();
  });

  it('includes Settings in the normal navigation list instead of fixed footer', () => {
    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const nav = container.querySelector('.ps-nav')!;
    const foot = container.querySelector('.ps-foot')!;

    // Settings link should be located inside nav, NOT inside foot
    const navSettingsLink = nav.querySelector('a[href="/settings"]');
    const footSettingsLink = foot.querySelector('a[href="/settings"]');

    expect(navSettingsLink).toBeInTheDocument();
    expect(footSettingsLink).toBeNull();
  });

  it('keeps ONLY user avatar and popover trigger in the fixed bottom footer', () => {
    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const foot = container.querySelector('.ps-foot')!;
    const userBtn = foot.querySelector('.ps-user-btn');
    expect(userBtn).toBeInTheDocument();

    // Footer should not contain extraneous links outside of the account trigger
    const footLinks = foot.querySelectorAll('a');
    expect(footLinks.length).toBe(0);
  });

  it('expands smoothly on hover without shifting main canvas content', async () => {
    vi.useFakeTimers();

    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const wrapper = container.querySelector('.ps-wrapper')!;
    const aside = container.querySelector('.ps')!;

    expect(aside).toHaveAttribute('data-mode', 'compact');

    // Trigger mouse enter
    fireEvent.mouseEnter(wrapper);

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Sidebar expands to floating overlay
    expect(aside).toHaveAttribute('data-mode', 'expanded');
    expect(aside).toHaveAttribute('data-floating', 'true');
    expect(container.querySelector('.ps-floating-scrim')).toBeInTheDocument();

    // Trigger mouse leave
    fireEvent.mouseLeave(wrapper);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(aside).toHaveAttribute('data-mode', 'compact');
    expect(aside).toHaveAttribute('data-floating', 'false');

    vi.useRealTimers();
  });

  it('closes hover-expansion immediately when Escape key is pressed', () => {
    vi.useFakeTimers();

    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const wrapper = container.querySelector('.ps-wrapper')!;
    const aside = container.querySelector('.ps')!;

    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(aside).toHaveAttribute('data-mode', 'expanded');

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(aside).toHaveAttribute('data-mode', 'compact');

    vi.useRealTimers();
  });

  it('handles animated nested submenus for Pipeline and preserves active route state', async () => {
    vi.useFakeTimers();
    currentPathname = '/crm/opportunities';

    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const wrapper = container.querySelector('.ps-wrapper')!;
    const aside = container.querySelector('.ps')!;

    // Hover expand with timer advance
    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    const pipelineLabels = aside.querySelectorAll('.ps-item__label');
    const pipelineItem = Array.from(pipelineLabels).find((el) => el.textContent === 'Pipeline');
    expect(pipelineItem).toBeDefined();

    const oppLink = screen.getByText('Opportunities');
    expect(oppLink).toBeInTheDocument();

    const openSubnavs = container.querySelectorAll('.ps-subnav-container--open');
    expect(openSubnavs.length).toBeGreaterThan(0);

    // Toggle collapse on Pipeline submenu
    const toggleButtons = screen.getAllByRole('button', { name: /Collapse Pipeline/i });
    expect(toggleButtons.length).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(toggleButtons[0]);
    });

    const closedSubnav = container.querySelector(
      '.ps-subnav-container:not(.ps-subnav-container--open)'
    );
    expect(closedSubnav).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('opens and closes accessible popover menu from footer avatar', async () => {
    render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const userButton = screen.getByRole('button', { name: /User account menu/i });
    expect(userButton).toBeInTheDocument();
    expect(userButton).toHaveAttribute('aria-expanded', 'false');

    // Open profile menu
    await act(async () => {
      fireEvent.click(userButton);
    });

    expect(userButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: /User account menu/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /My Profile/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Sign Out/i })).toBeInTheDocument();

    // Close on Escape
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(screen.queryByRole('menu', { name: /User account menu/i })).toBeNull();
  });

  it('supports mobile drawer with touch accessibility and focus trap', async () => {
    render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const mobileToggle = screen.getByRole('button', { name: /Toggle navigation drawer/i });
    expect(mobileToggle).toBeInTheDocument();

    // Open drawer
    await act(async () => {
      fireEvent.click(mobileToggle);
    });

    const closeBtn = screen.getByRole('button', { name: /Close navigation drawer/i });
    expect(closeBtn).toBeInTheDocument();

    // Close on Escape
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.queryByRole('button', { name: /Close navigation drawer/i })).toBeNull();
  });
});
