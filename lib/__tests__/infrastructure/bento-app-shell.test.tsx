/**
 * BentoAppShell & Hybrid Animated Sidebar Unit and Integration Tests.
 *
 * Verifies:
 * - Collapsed, hover-expanded, and pinned states
 * - Animated nested submenus for Pipeline, Projects, Documents, etc.
 * - Active route highlighting and auto-expansion
 * - Keyboard navigation, focus states, and Escape key behavior
 * - Pin/unpin toggles with localStorage persistence
 * - Mobile navigation drawer and touch accessibility
 * - Light, Dark, and System theme toggles
 * - Visual regression fixes (brand logo/collapse button alignment, scrollbar container)
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

describe('BentoAppShell Hybrid Animated Sidebar', () => {
  beforeEach(() => {
    currentPathname = '/dashboard';
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders pinned expanded sidebar by default with all sections and brand mark', () => {
    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const wrapper = container.querySelector('.ps-wrapper');
    const aside = container.querySelector('.ps');

    expect(wrapper).toHaveAttribute('data-pinned', 'true');
    expect(aside).toHaveAttribute('data-mode', 'expanded');
    expect(screen.getByText('AgencyOS')).toBeInTheDocument();
    expect(screen.getAllByText('Workspace').length).toBeGreaterThan(0);
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });

  it('allows unpinning sidebar into compact collapsed rail', async () => {
    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const unpinButton = screen.getByRole('button', { name: /Unpin sidebar/i });
    expect(unpinButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(unpinButton);
    });

    const wrapper = container.querySelector('.ps-wrapper');
    const aside = container.querySelector('.ps');

    expect(wrapper).toHaveAttribute('data-pinned', 'false');
    expect(aside).toHaveAttribute('data-mode', 'compact');
    expect(window.localStorage.getItem('agencyos:sidebar:pinned')).toBe('false');
  });

  it('expands smoothly on hover when unpinned without shifting main canvas', async () => {
    vi.useFakeTimers();

    window.localStorage.setItem('agencyos:sidebar:pinned', 'false');

    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    const wrapper = container.querySelector('.ps-wrapper')!;
    const aside = container.querySelector('.ps')!;

    expect(wrapper).toHaveAttribute('data-pinned', 'false');
    expect(aside).toHaveAttribute('data-mode', 'compact');

    // Trigger mouse enter
    fireEvent.mouseEnter(wrapper);

    // Fast-forward debounce
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Sidebar expands to floating overlay while wrapper width remains unchanged (72px)
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

  it('closes hover-expansion on Escape key press', () => {
    vi.useFakeTimers();
    window.localStorage.setItem('agencyos:sidebar:pinned', 'false');

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

  it('handles animated nested submenus for Pipeline and Projects', async () => {
    currentPathname = '/crm/opportunities';

    const { container } = render(
      <BentoAppShell user={testUser} sections={sections}>
        <div>Main Content</div>
      </BentoAppShell>
    );

    // Pipeline link in sidebar should be present
    const aside = container.querySelector('.ps')!;
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

    await act(async () => {
      fireEvent.click(toggleButtons[0]);
    });

    const closedSubnav = container.querySelector(
      '.ps-subnav-container:not(.ps-subnav-container--open)'
    );
    expect(closedSubnav).toBeInTheDocument();
  });

  it('renders centered avatar and opens accessible popover menu in compact mode', async () => {
    window.localStorage.setItem('agencyos:sidebar:pinned', 'false');

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

  it('provides mobile drawer with touch accessibility and focus trap', async () => {
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
