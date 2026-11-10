'use client';

/**
 * AgencyOS application sidebar.
 *
 * Presentational only: the section list is resolved on the server (session +
 * permissions) by components/server/module-shell.tsx and passed in, so the
 * menu is permission-aware without shipping authorization logic to the
 * browser. The sidebar itself is rendered once per request by the shared
 * AppShell - no module has its own copy.
 */

import * as React from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { classNames } from '@/lib/utils';
import { BrandMark } from '@/components/brand/brand-mark';
import { allNavItems, resolveActiveHref, type NavIconKey, type NavSection } from '@/lib/navigation';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Calculator,
  ChevronLeft,
  Clock,
  CreditCard,
  File,
  FileSignature,
  FileText,
  Flag,
  FolderKanban,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  LayoutTemplate,
  Link2,
  Menu,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Target,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  Workflow,
  X,
} from 'lucide-react';

/** Icon keys (serializable) → lucide components (client-only). */
export const SIDEBAR_ICONS: Record<NavIconKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  contacts: Users,
  accounts: Building2,
  pipelines: GitBranch,
  pipelineStages: GitPullRequest,
  leads: UserPlus,
  opportunities: Target,
  proposals: FileText,
  quotations: Receipt,
  invoices: CreditCard,
  estimates: Calculator,
  expenses: Wallet,
  reports: BarChart3,
  projects: FolderKanban,
  projectTemplates: LayoutTemplate,
  changeOrders: GitPullRequest,
  timeEntries: Clock,
  contracts: FileSignature,
  documentTemplates: File,
  sharedLinks: Link2,
  workflows: Workflow,
  notifications: Bell,
  users: UserCog,
  roles: ShieldCheck,
  auditLog: ScrollText,
  featureFlags: Flag,
  health: Activity,
  settings: Settings,
};

interface SidebarProps {
  /** Organization brand name (falls back to the product name). */
  brandName?: string;
  /** Validated organization logo URL, if any. */
  logoUrl?: string | null;
  /** Sections already filtered for the current user's permissions. */
  sections: readonly NavSection[];
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isOpen?: boolean;
  setIsOpen?: (open: boolean) => void;
}

export function Sidebar({
  brandName = 'AgencyOS',
  logoUrl = null,
  sections,
  isCollapsed,
  setIsCollapsed,
  isOpen = false,
  setIsOpen,
}: SidebarProps) {
  const pathname = usePathname();
  const activeHref = resolveActiveHref(pathname ?? '', allNavItems(sections));

  // Close mobile drawer on Escape key
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && setIsOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [setIsOpen]);

  // Sidebar width: full width on mobile regardless of collapsed state;
  // desktop respects collapsed/expanded.
  const sidebarWidth = classNames(
    'w-64', // mobile default: full 256px
    isCollapsed ? 'sm:w-16' : 'sm:w-64' // desktop: collapsed/expanded
  );

  // Translate: off-screen to the LEFT when closed (mobile only).
  // Desktop is always visible via sm:!translate-x-0.
  const sidebarTranslate = classNames(
    '-translate-x-full sm:!translate-x-0',
    isOpen ? 'translate-x-0' : '-translate-x-full'
  );

  // Expanded: labels shown and expanded-style active states.
  // True when desktop is expanded OR mobile drawer is open,
  // independent of the desktop collapsed state.
  const expanded = isOpen || !isCollapsed;

  return (
    <aside
      aria-label="Main navigation"
      className={classNames(
        'fixed inset-y-0 left-0 z-50 border-r border-border bg-background transition-all duration-300 ease-in-out',
        sidebarWidth,
        sidebarTranslate
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-12 items-center justify-between border-b border-border bg-background p-4 shrink-0 relative">
          {/* Brand mark: shown when the sidebar is expanded (desktop or open
              mobile drawer). Falls back to "AgencyOS" when the organization has
              configured nothing, and to the name alone if the logo fails. */}
          {expanded && <BrandMark name={brandName} logoUrl={logoUrl} />}

          {/* Right-aligned toggle: collapse chevron (expanded desktop) or close button (open mobile drawer) */}
          {expanded && (
            <button
              onClick={isOpen ? () => setIsOpen?.(false) : () => setIsCollapsed(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
              aria-label={isOpen ? 'Close sidebar' : 'Collapse sidebar'}
            >
              {isOpen ? <X className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
          )}

          {/* Centered hamburger: shown only when sidebar is collapsed (desktop collapsed) */}
          {isCollapsed && !isOpen && (
            <div className="absolute inset-x-0 flex items-center justify-center">
              <button
                onClick={() => setIsCollapsed(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
                aria-label="Expand sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-4">
          {sections.map((section) => (
            <div key={section.id}>
              {expanded && (
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </p>
              )}
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const Icon = SIDEBAR_ICONS[item.icon];
                  const isActive = activeHref === item.href;
                  return (
                    <li key={item.href}>
                      <NextLink
                        href={item.href}
                        onClick={() => setIsOpen?.(false)}
                        aria-current={isActive ? 'page' : undefined}
                        title={expanded ? undefined : item.name}
                        className={classNames(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                          isActive && expanded
                            ? 'bg-accent text-accent-foreground'
                            : isActive && !expanded
                              ? 'text-accent-foreground'
                              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                        aria-label={item.name}
                      >
                        {/* Centered square active state for collapsed desktop only */}
                        <div
                          className={classNames(
                            'flex items-center justify-center w-8 h-8 shrink-0 rounded-md transition-colors',
                            isActive && !expanded
                              ? 'bg-accent text-accent-foreground'
                              : isActive && expanded
                                ? 'text-accent-foreground'
                                : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                          )}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        {expanded && <span className="min-w-0 truncate">{item.name}</span>}
                      </NextLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
