/**
 * AgencyOS navigation model.
 *
 * Single source of truth for the application sidebar and navigation hierarchy.
 * Every module renders the same shell (components/layout/bento-app-shell.tsx and app-shell.tsx)
 * and therefore the same navigation structure.
 *
 * Approved Arena Bento sidebar hierarchy (left to right, top to bottom):
 *
 *  1. Today                    -> /dashboard (emerald pill when active)
 *  2. Clients & Contacts       -> /crm/contacts
 *  3. Sales CRM & Leads
 *       - Leads & Follow-ups   -> /crm/leads
 *       - Pipeline Board       -> /crm/opportunities
 *  4. Sales Documents
 *       - Quotations           -> /sales/quotations
 *       - Agreements           -> /documents/contracts
 *       - Document Templates   -> /documents/templates
 *  5. Projects & Tasks
 *       - All Projects         -> /projects
 *       - Reviews & Handovers  -> /projects/approvals
 *  6. Client Portal           -> pending (no staff-facing portal area)
 *  7. Billing & Invoices
 *       - Invoices             -> /finance/invoices
 *  8. Service Catalog         -> pending (no catalog route)
 *  9. Asset Library           -> pending (files are per project only)
 *     (subtle divider)
 * 10. Automations
 *       - Workflow Rules       -> /automation/rules
 *       - Reminders & Alerts   -> /automation/notifications
 * 11. Reports                 -> /finance/reports
 * 12. Settings                -> /settings (also active on linked team/admin pages)
 *
 * Settings absorbed the retired "Manage Team" and "Agency Settings" groups. The
 * Settings Center (components/settings/bento-settings-view.tsx) is grouped into
 * My Account, Workspace, Billing and Team & Permissions, and keeps the
 * /settings#branding and /settings#invoice-numbering deep links working.
 *
 * Destinations that do not exist yet are intentionally absent from the menu and
 * tracked in `PENDING_NAV_DESTINATIONS`. Groups are hidden automatically once
 * permission filtering (or the absence of a destination) leaves them empty.
 *
 * Proposals and Estimates are retired from the active sidebar:
 * - Estimates cannot be created from the UI; existing records stay readable at
 *   /finance/estimates for audit and history.
 * - Proposals stay reachable at /sales/proposals (including historical records)
 *   but are no longer advertised in the sidebar.
 * Quotation -> Invoice and the optional Quotation -> Agreement flows are
 * unchanged and remain reachable through Sales Documents -> Quotations.
 *
 * Permission codes mirror the ones enforced by the corresponding service layer.
 * Items without a `permission` key are accessible to all authenticated organization members.
 * Group items ("parents") deliberately carry no permission of their own: a group is
 * visible only while at least one of its permission-filtered children is visible.
 */

export type NavIconKey =
  | 'dashboard'
  | 'contacts'
  | 'accounts'
  | 'pipelines'
  | 'pipelineStages'
  | 'leads'
  | 'opportunities'
  | 'proposals'
  | 'quotations'
  | 'invoices'
  | 'expenses'
  | 'reports'
  | 'projects'
  | 'projectTemplates'
  | 'approvals'
  | 'changeOrders'
  | 'timeEntries'
  | 'contracts'
  | 'documentTemplates'
  | 'sharedLinks'
  | 'workflows'
  | 'notifications'
  | 'users'
  | 'roles'
  | 'auditLog'
  | 'featureFlags'
  | 'health'
  | 'settings';

export interface NavSubItem {
  name: string;
  /**
   * Route within the app (always absolute). A `#fragment` targets a panel inside
   * the destination page (e.g. /settings#branding is resolved by the settings view).
   */
  href: string;
  permission?: string;
}

export interface NavItem {
  /** Label shown in the sidebar. */
  name: string;
  /** Route within the app (always absolute). For groups this is the default landing. */
  href: string;
  icon: NavIconKey;
  /** Permission code required to see the item. Omit for always-visible items. */
  permission?: string;
  /** Optional nested sub-items (e.g. Sales CRM & Leads -> Leads, Pipeline Board). */
  subItems?: NavSubItem[];
  /** Visual treatment for the active state. `emerald` renders the active item as a pill. */
  accent?: 'emerald';
  /** Render a subtle separator above this item. */
  dividerBefore?: boolean;
  /**
   * Extra route prefixes that mark this item active (e.g. Settings stays active
   * on the team administration pages it links to).
   */
  activePrefixes?: string[];
}

export interface NavSection {
  id: string;
  /** Optional section heading. Omitted sections render without a label. */
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'workspace',
    items: [
      { name: 'Today', href: '/dashboard', icon: 'dashboard', accent: 'emerald' },
      {
        name: 'Clients & Contacts',
        href: '/crm/contacts',
        icon: 'contacts',
        permission: 'contact.read',
      },
      {
        name: 'Sales CRM & Leads',
        href: '/crm/leads',
        icon: 'leads',
        subItems: [
          { name: 'Leads & Follow-ups', href: '/crm/leads', permission: 'lead.read' },
          { name: 'Pipeline Board', href: '/crm/opportunities', permission: 'opportunity.read' },
        ],
      },
      {
        name: 'Sales Documents',
        href: '/sales/quotations',
        icon: 'quotations',
        subItems: [
          { name: 'Quotations', href: '/sales/quotations', permission: 'quotation.read' },
          { name: 'Agreements', href: '/documents/contracts', permission: 'contract.read' },
          {
            name: 'Document Templates',
            href: '/documents/templates',
            permission: 'template.read',
          },
        ],
      },
      {
        name: 'Projects & Tasks',
        href: '/projects',
        icon: 'projects',
        subItems: [
          { name: 'All Projects', href: '/projects', permission: 'project.read' },
          {
            name: 'Reviews & Handovers',
            href: '/projects/approvals',
            permission: 'project.approval.read',
          },
        ],
      },
      {
        name: 'Billing & Invoices',
        href: '/finance/invoices',
        icon: 'invoices',
        subItems: [{ name: 'Invoices', href: '/finance/invoices', permission: 'invoice.read' }],
      },
      {
        name: 'Automations',
        href: '/automation/rules',
        icon: 'workflows',
        dividerBefore: true,
        subItems: [
          { name: 'Workflow Rules', href: '/automation/rules', permission: 'workflow.read' },
          {
            name: 'Reminders & Alerts',
            href: '/automation/notifications',
            permission: 'notification.read',
          },
        ],
      },
      {
        name: 'Reports',
        href: '/finance/reports',
        icon: 'reports',
        permission: 'invoice.read',
      },
      {
        name: 'Settings',
        href: '/settings',
        icon: 'settings',
        // Settings owns the account/workspace panels plus the team administration
        // pages it links to, so the rail keeps highlighting it there.
        activePrefixes: ['/admin', '/automation/preferences'],
      },
    ],
  },
] as const;

export interface PendingNavDestination {
  /** Label requested for the sidebar. */
  label: string;
  /** Group the label belongs to (for the PR's Pending Routes table). */
  parent: string;
  /** Route that would back the label once the destination ships; null when none exists. */
  expectedHref: string | null;
  /** Why the destination cannot be linked today. */
  reason: string;
}

/**
 * Requested sidebar destinations that have no working destination in the app yet.
 *
 * These are intentionally NOT rendered: the sidebar only links to destinations
 * that exist and support the label and workflow. They are tracked here so the
 * menu, the tests, and the PR description stay in sync.
 */
export const PENDING_NAV_DESTINATIONS: readonly PendingNavDestination[] = [
  {
    label: 'Briefs',
    parent: 'Sales Documents',
    expectedHref: null,
    reason: 'No briefs route, service, or model exists. Quotation briefs live inside quotations.',
  },
  {
    label: 'My Tasks',
    parent: 'Projects & Tasks',
    expectedHref: null,
    reason:
      'Tasks are only exposed per project (/projects/[id]) plus task APIs; there is no organization-wide task list.',
  },
  {
    label: 'Calendar',
    parent: 'Projects & Tasks',
    expectedHref: null,
    reason: 'No calendar/scheduling route exists.',
  },
  {
    label: 'Client Portal',
    parent: 'Workspace',
    expectedHref: null,
    reason:
      'Only the isolated client-facing portal exists (/portal, separate portal session). There is no staff-facing portal area; staff manage portal invites from a contact record.',
  },
  {
    label: 'Proforma Invoices',
    parent: 'Billing & Invoices',
    expectedHref: null,
    reason: 'No proforma invoice route, service, or document type exists.',
  },
  {
    label: 'Payments & Balances',
    parent: 'Billing & Invoices',
    expectedHref: null,
    reason:
      'Invoice payments are recorded from an invoice detail page via the payments API; there is no organization-wide payments or balances register.',
  },
  {
    label: 'Payment Receipts',
    parent: 'Billing & Invoices',
    expectedHref: null,
    reason: 'No receipt route or printable receipt exists.',
  },
  {
    label: 'Credit Notes',
    parent: 'Billing & Invoices',
    expectedHref: null,
    reason: 'No credit-note route, service, or document type exists.',
  },
  {
    label: 'Service Catalog',
    parent: 'Workspace',
    expectedHref: null,
    reason: 'No service catalog route or model exists; invoice/quotation line items are free-form.',
  },
  {
    label: 'Asset Library',
    parent: 'Workspace',
    expectedHref: null,
    reason:
      'Files exist only per project (/projects/[id]/files). There is no organization-wide asset library route.',
  },
  {
    label: 'Integrations',
    parent: 'Settings',
    expectedHref: '/settings#integrations',
    reason:
      'The Integrations card in the Settings Center is labelled "Coming Soon"; no integration configuration exists.',
  },
];

/**
 * Keep only the navigation sections the actor can actually use.
 * Filters both top-level items and nested subItems, and drops group items whose
 * children were all filtered out (an empty group must never render).
 */
export function filterNavigation(
  sections: readonly NavSection[],
  permissions: ReadonlySet<string>
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => item.permission === undefined || permissions.has(item.permission))
        .map((item) => ({
          ...item,
          subItems: item.subItems?.filter(
            (sub) => sub.permission === undefined || permissions.has(sub.permission)
          ),
        }))
        .filter((item) => item.subItems === undefined || (item.subItems?.length ?? 0) > 0),
    }))
    .filter((section) => section.items.length > 0);
}

/** Strip a `#fragment` so a menu entry can be compared with a pathname. */
export function navPath(href: string): string {
  const hashIndex = href.indexOf('#');
  return hashIndex === -1 ? href : href.slice(0, hashIndex);
}

/**
 * The href a parent/group item should link to: the first visible child, so a
 * group never links to a destination the actor may not open. Falls back to the
 * item's own href for direct links.
 */
export function primaryNavHref(item: NavItem): string {
  const children = item.subItems ?? [];
  if (children.length === 0) return item.href;
  // Panels of the same page (e.g. /settings#branding) must not replace the page link.
  const fragmentOnly = children.every((child) => navPath(child.href) === navPath(item.href));
  return fragmentOnly ? item.href : children[0].href;
}

/** All items and subItems from a section list, flattened (used for active-link resolution). */
export function allNavItems(sections: readonly NavSection[]): Array<{
  name: string;
  href: string;
  icon?: NavIconKey;
  permission?: string;
  activePrefixes?: string[];
}> {
  return sections.flatMap((section) =>
    section.items.flatMap((item) => [
      {
        name: item.name,
        href: primaryNavHref(item),
        icon: item.icon,
        permission: item.permission,
        activePrefixes: item.activePrefixes,
      },
      ...(item.subItems?.map((s) => ({
        name: s.name,
        href: s.href,
        icon: item.icon,
        permission: s.permission,
      })) ?? []),
    ])
  );
}

/**
 * Does `pathname` belong to the route `href`?
 * Fragments (`/settings#branding`) are ignored for path matching.
 */
export function isHrefActive(pathname: string, href: string): boolean {
  if (!pathname || !href) return false;
  const route = navPath(href);
  const cleanPath = navPath(pathname);
  const normalizedPath = cleanPath.length > 1 ? cleanPath.replace(/\/+$/, '') : cleanPath;
  const normalizedHref = route.length > 1 ? route.replace(/\/+$/, '') : route;
  return normalizedPath === normalizedHref || normalizedPath.startsWith(`${normalizedHref}/`);
}

/**
 * Resolve the single active navigation href for a pathname.
 *
 * Fragment links win when the browser is on that fragment, otherwise the most
 * specific route wins (so /projects/approvals beats /projects).
 */
export function resolveActiveHref(
  pathname: string,
  items: ReadonlyArray<{ name: string; href: string; activePrefixes?: string[] }>
): string | null {
  const hash = pathname.includes('#') ? `#${pathname.split('#')[1]}` : '';
  let best: string | null = null;
  for (const item of items) {
    if (hash && item.href.endsWith(hash) && isHrefActive(pathname, item.href)) {
      return item.href;
    }
    if (!isHrefActive(pathname, item.href)) continue;
    if (best === null || navPath(item.href).length > navPath(best).length) best = item.href;
  }
  if (best !== null) return best;
  // No menu route matched: fall back to an item that claims this area (Settings
  // covers the team administration pages linked from the Settings Center).
  for (const item of items) {
    if (item.activePrefixes?.some((prefix) => isHrefActive(pathname, prefix))) return item.href;
  }
  return null;
}
