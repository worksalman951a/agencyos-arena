/**
 * Navigation model tests.
 *
 * The sidebar is rendered from `NAV_SECTIONS` for every module, so this file
 * guards the things that can silently break the menu for everyone: the approved
 * Bento hierarchy, permission filtering, active-link resolution, and links that
 * point at routes which do not exist.
 *
 * Destinations that have no working route yet are tracked in
 * `PENDING_NAV_DESTINATIONS` and must never be rendered as links.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { SIDEBAR_ICONS } from '@/components/layout/sidebar';
import { NAV_ICONS } from '@/components/layout/nav-icons';
import {
  allNavItems,
  filterNavigation,
  isHrefActive,
  navPath,
  NAV_SECTIONS,
  PENDING_NAV_DESTINATIONS,
  primaryNavHref,
  resolveActiveHref,
  type NavItem,
} from '@/lib/navigation';

const PRIMARY_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);
const PRIMARY_NAMES = PRIMARY_ITEMS.map((item) => item.name);
const SUB_ITEM_NAMES = PRIMARY_ITEMS.flatMap((item) => item.subItems?.map((sub) => sub.name) ?? []);

function routeExists(href: string): boolean {
  return fs.existsSync(path.join(process.cwd(), 'app', navPath(href), 'page.tsx'));
}

function allPermissions(): Set<string> {
  return new Set(
    NAV_SECTIONS.flatMap((section) => [
      section.items.map((item) => item.permission),
      section.items.flatMap((item) => item.subItems?.map((sub) => sub.permission) ?? []),
    ])
      .flat()
      .filter((code): code is string => Boolean(code))
  );
}

describe('bento sidebar hierarchy', () => {
  it('renders the approved top-level order', () => {
    expect(PRIMARY_NAMES).toEqual([
      'Today',
      'Clients & Contacts',
      'Sales CRM & Leads',
      'Sales Documents',
      'Projects & Tasks',
      'Billing & Invoices',
      'Automations',
      'Reports',
      'Manage Team',
      'Agency Settings',
    ]);
  });

  it('nests the approved sub-items in order', () => {
    const groups = Object.fromEntries(
      PRIMARY_ITEMS.filter((item) => item.subItems?.length).map((item) => [
        item.name,
        item.subItems!.map((sub) => sub.name),
      ])
    );

    expect(groups).toEqual({
      'Sales CRM & Leads': ['Leads & Follow-ups', 'Pipeline Board'],
      'Sales Documents': ['Quotations', 'Agreements', 'Document Templates'],
      'Projects & Tasks': ['All Projects', 'Reviews & Handovers'],
      'Billing & Invoices': ['Invoices'],
      Automations: ['Workflow Rules', 'Reminders & Alerts'],
      'Manage Team': ['Team Members', 'Roles & Permissions'],
      'Agency Settings': ['Workspace Branding', 'Invoice Numbering'],
    });
  });

  it('places exactly one subtle divider before the tools group', () => {
    expect(PRIMARY_ITEMS.filter((item) => item.dividerBefore).map((item) => item.name)).toEqual([
      'Automations',
    ]);
  });

  it('marks Today as the guided dashboard entry with the emerald pill', () => {
    const today = PRIMARY_ITEMS[0];
    expect(today).toMatchObject({ name: 'Today', href: '/dashboard', accent: 'emerald' });
    expect(today.subItems).toBeUndefined();
  });

  it('gives groups no permission of their own so children drive visibility', () => {
    for (const item of PRIMARY_ITEMS) {
      if (item.subItems?.length) {
        expect(item.permission, `${item.name} should not gate its own children`).toBeUndefined();
      }
    }
  });
});

describe('pending destinations', () => {
  it('never renders a destination without a working route', () => {
    for (const pending of PENDING_NAV_DESTINATIONS) {
      expect(PRIMARY_NAMES).not.toContain(pending.label);
      expect(SUB_ITEM_NAMES).not.toContain(pending.label);
    }
  });

  it('documents why each pending destination is missing', () => {
    for (const pending of PENDING_NAV_DESTINATIONS) {
      expect(pending.reason.length).toBeGreaterThan(20);
      expect(pending.parent.length).toBeGreaterThan(0);
    }
  });

  it('lists the requested but unrouted destinations', () => {
    expect(PENDING_NAV_DESTINATIONS.map((pending) => pending.label)).toEqual(
      expect.arrayContaining([
        'Briefs',
        'My Tasks',
        'Calendar',
        'Client Portal',
        'Proforma Invoices',
        'Payments & Balances',
        'Payment Receipts',
        'Credit Notes',
        'Service Catalog',
        'Asset Library',
        'Integrations',
      ])
    );
  });

  it('does not point a pending destination at a route it does not have', () => {
    for (const pending of PENDING_NAV_DESTINATIONS) {
      if (pending.expectedHref) {
        expect(pending.expectedHref.startsWith('/')).toBe(true);
      }
    }
  });
});

describe('filterNavigation', () => {
  it('keeps only items the actor has permission for', () => {
    const sections = filterNavigation(NAV_SECTIONS, new Set(['invoice.read']));

    const hrefs = allNavItems(sections).map((item) => item.href);
    expect(hrefs).toContain('/finance/invoices');
    expect(hrefs).not.toContain('/crm/contacts');
    expect(hrefs).not.toContain('/admin/users');
  });

  it('still exposes ungated items (Today, Agency Settings) to a member with no permissions', () => {
    const sections = filterNavigation(NAV_SECTIONS, new Set());

    expect(sections.map((section) => section.id)).toEqual(['workspace']);
    expect(sections[0].items.map((item) => item.name)).toEqual(['Today', 'Agency Settings']);
  });

  it('hides a group when every child was filtered out', () => {
    const sections = filterNavigation(NAV_SECTIONS, new Set(['contact.read']));
    const names = sections[0].items.map((item) => item.name);

    expect(names).toEqual(['Today', 'Clients & Contacts', 'Agency Settings']);
    expect(names).not.toContain('Sales Documents');
    expect(names).not.toContain('Automations');
    expect(names).not.toContain('Manage Team');
  });

  it('keeps a group whose remaining child is permitted, and links there', () => {
    const sections = filterNavigation(NAV_SECTIONS, new Set(['template.read']));
    const salesDocuments = sections[0].items.find((item) => item.name === 'Sales Documents');

    expect(salesDocuments?.subItems?.map((sub) => sub.name)).toEqual(['Document Templates']);
    expect(salesDocuments && primaryNavHref(salesDocuments)).toBe('/documents/templates');
  });

  it('shows the whole menu to a fully-privileged administrator', () => {
    const sections = filterNavigation(NAV_SECTIONS, allPermissions());

    expect(sections.map((section) => section.id)).toEqual(['workspace']);
    expect(sections[0].items.map((item) => item.name)).toEqual(PRIMARY_NAMES);
    for (const item of sections[0].items) {
      expect(item.subItems?.length ?? 0).toBe(
        NAV_SECTIONS[0].items.find((source) => source.name === item.name)?.subItems?.length ?? 0
      );
    }
  });

  it('drops sections that contain no visible items', () => {
    const sections = filterNavigation([], new Set(['invoice.read']));
    expect(sections).toEqual([]);
  });
});

describe('navigation targets', () => {
  it('only links to routes that exist in the app directory', () => {
    const missing = allNavItems(NAV_SECTIONS)
      .map((item) => item.href)
      .filter((href) => !routeExists(href));

    expect(missing).toEqual([]);
  });

  it('resolves panel fragments to real pages', () => {
    const fragmentHrefs = allNavItems(NAV_SECTIONS)
      .map((item) => item.href)
      .filter((href) => href.includes('#'));

    expect(fragmentHrefs).toEqual(
      expect.arrayContaining(['/settings#branding', '/settings#invoice-numbering'])
    );
    for (const href of fragmentHrefs) {
      expect(routeExists(href)).toBe(true);
    }
  });

  it('links Billing & Invoices -> Invoices to the invoice register', () => {
    const billing = PRIMARY_ITEMS.find((item) => item.name === 'Billing & Invoices');
    expect(billing?.subItems).toEqual([
      { name: 'Invoices', href: '/finance/invoices', permission: 'invoice.read' },
    ]);
    expect(primaryNavHref(billing as NavItem)).toBe('/finance/invoices');
    expect(routeExists('/finance/invoices')).toBe(true);
  });

  it('has no duplicate primary destinations', () => {
    const primaryHrefs = PRIMARY_ITEMS.map((item) => primaryNavHref(item));
    expect(new Set(primaryHrefs).size).toBe(primaryHrefs.length);
  });

  it('gives every item an icon key that both sidebars can resolve', () => {
    for (const item of allNavItems(NAV_SECTIONS)) {
      if (item.icon) {
        expect(Object.keys(SIDEBAR_ICONS)).toContain(item.icon);
        expect(Object.keys(NAV_ICONS)).toContain(item.icon);
      }
    }
  });
});

describe('retired and historical entry points', () => {
  it('keeps estimates out of the active navigation', () => {
    const hrefs = allNavItems(NAV_SECTIONS).map((item) => item.href);
    expect(hrefs.some((href) => navPath(href).startsWith('/finance/estimates'))).toBe(false);
  });

  it('keeps proposals out of the active navigation', () => {
    const hrefs = allNavItems(NAV_SECTIONS).map((item) => item.href);
    expect(hrefs.some((href) => navPath(href).startsWith('/sales/proposals'))).toBe(false);
  });

  it('no longer ships a new-estimate creation route', () => {
    expect(
      fs.existsSync(path.join(process.cwd(), 'app', 'finance/estimates/new', 'page.tsx'))
    ).toBe(false);
  });

  it('still keeps historical estimate records readable', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app', 'finance/estimates', 'page.tsx'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(process.cwd(), 'app/finance/estimates/[id]', 'page.tsx'))).toBe(
      true
    );
    expect(
      fs.existsSync(path.join(process.cwd(), 'app/api/v1/finance/estimates', 'route.ts'))
    ).toBe(true);
  });

  it('keeps proposals and the quotation -> invoice / agreement flows reachable', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/sales/proposals', 'page.tsx'))).toBe(true);
    expect(
      fs.existsSync(path.join(process.cwd(), 'app/api/v1/crm/quotations/[id]/invoice', 'route.ts'))
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(process.cwd(), 'app/api/v1/crm/quotations/[id]/agreement', 'route.ts')
      )
    ).toBe(true);
    // Quotes are still advertised in Sales Documents.
    expect(SUB_ITEM_NAMES).toContain('Quotations');
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

  it('ignores fragments on either side', () => {
    expect(isHrefActive('/settings#branding', '/settings')).toBe(true);
    expect(isHrefActive('/settings', '/settings#branding')).toBe(true);
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

  it('prefers the fragment panel when the URL carries that fragment', () => {
    const menu = allNavItems(NAV_SECTIONS);
    expect(resolveActiveHref('/settings#branding', menu)).toBe('/settings#branding');
    expect(resolveActiveHref('/settings', menu)).toBe('/settings');
  });

  it('keeps a group parent expanded while one of its children is active', () => {
    const menu = allNavItems(NAV_SECTIONS);
    expect(resolveActiveHref('/finance/invoices/abc123', menu)).toBe('/finance/invoices');
    expect(resolveActiveHref('/automation/notifications', menu)).toBe('/automation/notifications');
    expect(resolveActiveHref('/projects/approvals', menu)).toBe('/projects/approvals');
  });
});
