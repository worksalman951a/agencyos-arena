/**
 * Navigation model tests.
 *
 * The sidebar is rendered from `NAV_SECTIONS` for every module, so this file
 * guards the three things that can silently break the menu for everyone:
 * permission filtering, active-link resolution, and links that point at routes
 * which do not exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { SIDEBAR_ICONS } from '@/components/layout/sidebar';
import {
  allNavItems,
  filterNavigation,
  isHrefActive,
  NAV_SECTIONS,
  resolveActiveHref,
  type NavItem,
} from '@/lib/navigation';

describe('filterNavigation', () => {
  it('keeps only items the actor has permission for', () => {
    const sections = filterNavigation(NAV_SECTIONS, new Set(['invoice.read']));

    const hrefs = allNavItems(sections).map((item) => item.href);
    expect(hrefs).toContain('/finance/invoices');
    expect(hrefs).not.toContain('/crm/contacts');
    expect(hrefs).not.toContain('/admin/users');
  });

  it('drops sections whose items were all filtered out', () => {
    const sections = filterNavigation(NAV_SECTIONS, new Set(['invoice.read']));
    const ids = sections.map((section) => section.id);

    expect(ids).toContain('finance');
    expect(ids).not.toContain('admin');
    expect(ids).not.toContain('crm');
  });

  it('always keeps items that declare no permission (dashboard)', () => {
    const sections = filterNavigation(NAV_SECTIONS, new Set());

    const hrefs = allNavItems(sections).map((item) => item.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/dashboard']));
    // A member with no permissions sees only the dashboard group
    expect(sections.map((section) => section.id)).toEqual(['dashboard']);
  });

  it('shows every module to a fully-privileged administrator', () => {
    const allPermissions = new Set(
      NAV_SECTIONS.flatMap((section) => [
        section.items.map((item) => item.permission),
        section.items.flatMap((item) => item.subItems?.map((s) => s.permission) ?? []),
      ])
        .flat()
        .filter((code): code is string => Boolean(code))
    );

    const sections = filterNavigation(NAV_SECTIONS, allPermissions);
    expect(sections.map((section) => section.id)).toEqual([
      'dashboard',
      'clients-sales',
      'work-management',
      'finance',
      'tools',
    ]);
  });
});

describe('isHrefActive', () => {
  it('matches the route itself and its children', () => {
    expect(isHrefActive('/crm/contacts', '/crm/contacts')).toBe(true);
    expect(isHrefActive('/crm/contacts/abc123', '/crm/contacts')).toBe(true);
    expect(isHrefActive('/crm/contacts/abc123/edit', '/crm/contacts')).toBe(true);
  });

  it('ignores trailing slashes', () => {
    expect(isHrefActive('/finance/invoices/', '/finance/invoices')).toBe(true);
  });

  it('does not treat a sibling with the same prefix as a child route', () => {
    expect(isHrefActive('/crm/contacts-archive', '/crm/contacts')).toBe(false);
    expect(isHrefActive('/projects', '/pricing')).toBe(false);
  });
});

describe('resolveActiveHref', () => {
  const items: NavItem[] = [
    { name: 'Projects', href: '/projects', icon: 'projects' },
    { name: 'Time Entries', href: '/projects/time-entries', icon: 'timeEntries' },
  ];

  it('returns the most specific matching href', () => {
    expect(resolveActiveHref('/projects/time-entries/new', items)).toBe('/projects/time-entries');
    expect(resolveActiveHref('/projects/abc123', items)).toBe('/projects');
  });

  it('returns null when nothing matches', () => {
    expect(resolveActiveHref('/dashboard', items)).toBeNull();
  });
});

describe('navigation targets', () => {
  it('only links to routes that exist in the app directory', () => {
    const missing = allNavItems(NAV_SECTIONS)
      .map((item) => item.href)
      .filter((href) => !fs.existsSync(path.join(process.cwd(), 'app', href, 'page.tsx')));

    expect(missing).toEqual([]);
  });

  it('has no duplicate destinations across primary items and sub-items', () => {
    const primaryHrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
    // Each primary item is distinct
    expect(new Set(primaryHrefs).size).toBe(primaryHrefs.length);

    // Flat sub-item links can point to parent's root href as default entry (e.g. /projects -> /projects)
    const uniqueDests = new Set(allNavItems(NAV_SECTIONS).map((item) => item.href));
    expect(uniqueDests.size).toBeGreaterThan(15);
  });

  it('gives every item an icon key that the sidebar can resolve', () => {
    const iconKeys = Object.keys(SIDEBAR_ICONS);
    for (const item of allNavItems(NAV_SECTIONS)) {
      if (item.icon) {
        expect(iconKeys).toContain(item.icon);
      }
    }
  });
});
