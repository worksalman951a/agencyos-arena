/**
 * AgencyOS navigation model.
 *
 * Single source of truth for the application sidebar and navigation hierarchy.
 * Every module renders the same shell (components/layout/bento-app-shell.tsx and app-shell.tsx)
 * and therefore the same navigation structure.
 *
 * Approved Balanced Modern Navigation Hierarchy:
 * - Dashboard: /dashboard
 * - Clients & Sales: Contacts, Accounts, Leads, Pipeline (Opportunities, Stages), Proposals, Quotations
 * - Work Management: Projects (Projects, Templates), Time Tracking, Approvals, Change Orders
 * - Finance: Invoices, Estimates, Expenses, Reports
 * - Tools: Documents (Contracts, Document Templates, Shared Links), Automations (Workflow Rules)
 * - Fixed Footer: Settings (/settings) & User Account Menu
 *
 * Permission codes mirror the ones enforced by the corresponding service layer.
 * Items without a `permission` key are accessible to all authenticated organization members.
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
  href: string;
  permission?: string;
}

export interface NavItem {
  /** Label shown in the sidebar. */
  name: string;
  /** Route within the app (always absolute). */
  href: string;
  icon: NavIconKey;
  /** Permission code required to see the item. Omit for always-visible items. */
  permission?: string;
  /** Optional nested sub-items (e.g. Pipeline -> Opportunities, Stages). */
  subItems?: NavSubItem[];
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    items: [{ name: 'Dashboard', href: '/dashboard', icon: 'dashboard' }],
  },
  {
    id: 'clients-sales',
    label: 'Clients & Sales',
    items: [
      { name: 'Contacts', href: '/crm/contacts', icon: 'contacts', permission: 'contact.read' },
      { name: 'Accounts', href: '/crm/accounts', icon: 'accounts', permission: 'account.read' },
      { name: 'Leads', href: '/crm/leads', icon: 'leads', permission: 'lead.read' },
      {
        name: 'Pipeline',
        href: '/crm/opportunities',
        icon: 'pipelines',
        permission: 'opportunity.read',
        subItems: [
          { name: 'Opportunities', href: '/crm/opportunities', permission: 'opportunity.read' },
          { name: 'Pipeline Stages', href: '/crm/pipeline-stages', permission: 'pipeline.read' },
        ],
      },
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
    id: 'work-management',
    label: 'Work Management',
    items: [
      {
        name: 'Projects',
        href: '/projects',
        icon: 'projects',
        permission: 'project.read',
        subItems: [
          { name: 'All Projects', href: '/projects', permission: 'project.read' },
          {
            name: 'Project Templates',
            href: '/projects/templates',
            permission: 'project.template.read',
          },
        ],
      },
      {
        name: 'Time Tracking',
        href: '/projects/time-entries',
        icon: 'timeEntries',
        permission: 'time.entry.read',
      },
      {
        name: 'Approvals',
        href: '/projects/approvals',
        icon: 'approvals',
        permission: 'project.approval.read',
      },
      {
        name: 'Change Orders',
        href: '/projects/change-orders',
        icon: 'changeOrders',
        permission: 'change.order.read',
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
      { name: 'Reports', href: '/finance/reports', icon: 'reports', permission: 'invoice.read' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      {
        name: 'Documents',
        href: '/documents/contracts',
        icon: 'contracts',
        permission: 'contract.read',
        subItems: [
          { name: 'Contracts', href: '/documents/contracts', permission: 'contract.read' },
          { name: 'Document Templates', href: '/documents/templates', permission: 'template.read' },
          { name: 'Shared Links', href: '/documents/links', permission: 'document.read' },
        ],
      },
      {
        name: 'Automations',
        href: '/automation/rules',
        icon: 'workflows',
        permission: 'workflow.read',
        subItems: [
          { name: 'Workflow Rules', href: '/automation/rules', permission: 'workflow.read' },
        ],
      },
    ],
  },
] as const;

/**
 * Keep only the navigation sections the actor can actually use.
 * Filters both top-level items and nested subItems.
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
        })),
    }))
    .filter((section) => section.items.length > 0);
}

/** All items and subItems from a section list, flattened (used for active-link resolution). */
export function allNavItems(
  sections: readonly NavSection[]
): Array<{ name: string; href: string; icon?: NavIconKey; permission?: string }> {
  return sections.flatMap((section) =>
    section.items.flatMap((item) => [
      { name: item.name, href: item.href, icon: item.icon, permission: item.permission },
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
 */
export function isHrefActive(pathname: string, href: string): boolean {
  if (!pathname || !href) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return normalized === href || normalized.startsWith(`${href}/`);
}

/**
 * Resolve the single active navigation href for a pathname.
 */
export function resolveActiveHref(
  pathname: string,
  items: ReadonlyArray<{ name: string; href: string }>
): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (!isHrefActive(pathname, item.href)) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
}
