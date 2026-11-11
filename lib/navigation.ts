/**
 * AgencyOS navigation model.
 *
 * Single source of truth for the application sidebar. Every module renders
 * the same shell (see components/layout/app-shell.tsx) and therefore the same
 * navigation, so this file - not the individual route folders - determines
 * what exists in the menu.
 *
 * Deliberately serializable: icons are referenced by key and resolved inside
 * the client Sidebar component, so this module can be imported by both server
 * and client code (and unit-tested without React).
 *
 * Permission codes mirror the ones the corresponding service layer enforces
 * (see lib/services/**). An item whose permission the actor does not hold is
 * removed from the menu, so a user never sees a link to a page that would
 * answer 403. Items without a `permission` key are available to any
 * authenticated member of an organization.
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
  | 'estimates'
  | 'expenses'
  | 'reports'
  | 'projects'
  | 'projectTemplates'
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

export interface NavItem {
  /** Label shown in the sidebar. */
  name: string;
  /** Route within the app (always absolute, never a hardcoded host). */
  href: string;
  icon: NavIconKey;
  /** Permission code required to see the item. Omit for always-visible items. */
  permission?: string;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
      { name: 'Settings', href: '/settings', icon: 'settings' },
      // Diagnostics page performs no permission check of its own, so it is not
      // part of the admin-only group.
      { name: 'System Health', href: '/admin/health', icon: 'health' },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    items: [
      { name: 'Contacts', href: '/crm/contacts', icon: 'contacts', permission: 'contact.read' },
      { name: 'Accounts', href: '/crm/accounts', icon: 'accounts', permission: 'account.read' },
      { name: 'Pipelines', href: '/crm/pipelines', icon: 'pipelines', permission: 'pipeline.read' },
      {
        name: 'Pipeline Stages',
        href: '/crm/pipeline-stages',
        icon: 'pipelineStages',
        permission: 'pipeline.read',
      },
      { name: 'Leads', href: '/crm/leads', icon: 'leads', permission: 'lead.read' },
      {
        name: 'Opportunities',
        href: '/crm/opportunities',
        icon: 'opportunities',
        permission: 'opportunity.read',
      },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    items: [
      {
        name: 'Proposals',
        href: '/sales/proposals',
        icon: 'proposals',
        permission: 'proposal.read',
      },
      {
        name: 'Quotations',
        href: '/sales/quotations',
        icon: 'quotations',
        permission: 'quotation.read',
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { name: 'Invoices', href: '/finance/invoices', icon: 'invoices', permission: 'invoice.read' },
      {
        name: 'Estimates',
        href: '/finance/estimates',
        icon: 'estimates',
        permission: 'estimate.read',
      },
      { name: 'Expenses', href: '/finance/expenses', icon: 'expenses', permission: 'expense.read' },
      // Reports aggregate invoices, estimates and expenses; invoice.read is
      // the narrowest permission that unlocks every source it reads.
      { name: 'Reports', href: '/finance/reports', icon: 'reports', permission: 'invoice.read' },
    ],
  },
  {
    id: 'projects',
    label: 'Projects',
    items: [
      { name: 'Projects', href: '/projects', icon: 'projects', permission: 'project.read' },
      {
        name: 'Templates',
        href: '/projects/templates',
        icon: 'projectTemplates',
        permission: 'project.template.read',
      },
      {
        name: 'Change Orders',
        href: '/projects/change-orders',
        icon: 'changeOrders',
        permission: 'change.order.read',
      },
      {
        name: 'Time Entries',
        href: '/projects/time-entries',
        icon: 'timeEntries',
        permission: 'time.entry.read',
      },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    items: [
      {
        name: 'Contracts',
        href: '/documents/contracts',
        icon: 'contracts',
        permission: 'contract.read',
      },
      {
        name: 'Templates',
        href: '/documents/templates',
        icon: 'documentTemplates',
        permission: 'template.read',
      },
      {
        name: 'Shared Links',
        href: '/documents/links',
        icon: 'sharedLinks',
        permission: 'document.read',
      },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    items: [
      {
        name: 'Workflow Rules',
        href: '/automation/rules',
        icon: 'workflows',
        permission: 'workflow.read',
      },
      {
        name: 'Notifications',
        href: '/automation/notifications',
        icon: 'notifications',
        permission: 'notification.read',
      },
      {
        name: 'Preferences',
        href: '/automation/preferences',
        icon: 'settings',
        permission: 'notification.preference',
      },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      { name: 'Users', href: '/admin/users', icon: 'users', permission: 'user.read' },
      { name: 'Roles', href: '/admin/roles', icon: 'roles', permission: 'role.read' },
      {
        name: 'Invitations',
        href: '/admin/invitations',
        icon: 'users',
        permission: 'invitation.read',
      },
      {
        name: 'Audit Log',
        href: '/admin/audit-logs',
        icon: 'auditLog',
        permission: 'audit_log.read',
      },
      {
        name: 'Feature Flags',
        href: '/admin/feature-flags',
        icon: 'featureFlags',
        permission: 'feature_flag.read',
      },
    ],
  },
] as const;

/**
 * Keep only the navigation sections the actor can actually use.
 *
 * Sections whose items are all filtered out are dropped entirely, so a user
 * with no admin permissions never sees an empty "Administration" heading.
 */
export function filterNavigation(
  sections: readonly NavSection[],
  permissions: ReadonlySet<string>
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => item.permission === undefined || permissions.has(item.permission)
      ),
    }))
    .filter((section) => section.items.length > 0);
}

/** All items from a section list, flattened (used for active-link resolution). */
export function allNavItems(sections: readonly NavSection[]): NavItem[] {
  return sections.flatMap((section) => section.items);
}

/**
 * Does `pathname` belong to the route `href`?
 *
 * Exact matches count, and so do child routes: `/crm/contacts/abc` is inside
 * `/crm/contacts`, but `/crm/contacts-archive` is not.
 */
export function isHrefActive(pathname: string, href: string): boolean {
  if (!pathname || !href) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return normalized === href || normalized.startsWith(`${href}/`);
}

/**
 * Resolve the single active navigation href for a pathname.
 *
 * The longest matching href wins so that nested entries (for example
 * `/finance/invoices` inside `/finance`) highlight the most specific link.
 */
export function resolveActiveHref(pathname: string, items: readonly NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (!isHrefActive(pathname, item.href)) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
}
