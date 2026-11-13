'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Menu,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  Sun,
  Moon,
  Settings,
  Bell,
  X,
} from 'lucide-react';
import { Toaster as SonnerToaster } from 'sonner';
import { Toaster } from '@/components/ui/toaster';
import { signOut } from '@/lib/auth-client';
import { useTheme } from '@/components/providers/theme-provider';
import { NAV_ICONS } from '@/components/layout/nav-icons';
import { Avatar } from '@/components/ui/premium/primitives';
import { allNavItems, resolveActiveHref, type NavSection, type NavItem } from '@/lib/navigation';
import type { BrandContext } from '@/lib/services/settings/branding-service';
import '@/components/ui/premium/tokens.css';
import '@/components/ui/premium/primitives.css';
import './bento-shell.css';

interface ShellUser {
  id: string;
  name: string | null;
  email: string | null;
}

interface BentoAppShellProps {
  children: React.ReactNode;
  user: ShellUser;
  sections: readonly NavSection[];
  branding?: BrandContext | null;
}

export function BentoAppShell({ children, user, sections, branding }: BentoAppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { theme, resolvedTheme, mounted, setTheme } = useTheme();
  const [unreadCount, setUnreadCount] = React.useState<number>(0);
  const pathname = usePathname();
  const router = useRouter();

  // Safely fetch unread notification count on client mount
  React.useEffect(() => {
    let active = true;
    async function fetchUnread() {
      try {
        const res = await fetch('/api/v1/automation/notifications/unread-count');
        if (res.ok) {
          const data = await res.json();
          if (active && typeof data.unreadCount === 'number') {
            setUnreadCount(data.unreadCount);
          }
        }
      } catch {
        // gracefully handle network failure
      }
    }
    fetchUnread();
    return () => {
      active = false;
    };
  }, [pathname]);

  const sidebarRef = React.useRef<HTMLElement | null>(null);
  const toggleButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const flatItems = React.useMemo(() => allNavItems(sections), [sections]);
  const activeHref = resolveActiveHref(pathname ?? '', flatItems);

  // Track manually toggled items; active parents are dynamically computed
  const [userToggledParents, setUserToggledParents] = React.useState<Record<string, boolean>>({});

  // Auto-expand any group or parent containing the active sub-item
  const activeParentMap = React.useMemo(() => {
    const map: Record<string, boolean> = {};
    if (!pathname) return map;
    for (const sec of sections) {
      for (const item of sec.items) {
        if (
          item.subItems?.some((sub) => sub.href === activeHref || pathname.startsWith(sub.href))
        ) {
          map[item.name] = true;
        }
      }
    }
    return map;
  }, [sections, activeHref, pathname]);

  const isParentExpanded = React.useCallback(
    (itemName: string) => {
      // If user explicitly toggled it, respect user choice; otherwise default to active parent status
      if (typeof userToggledParents[itemName] === 'boolean') {
        return userToggledParents[itemName];
      }
      return Boolean(activeParentMap[itemName]);
    },
    [userToggledParents, activeParentMap]
  );

  // Focus trap and keyboard handling for mobile navigation drawer
  React.useEffect(() => {
    if (!mobileOpen) return;

    const timer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMobileOpen(false);
        toggleButtonRef.current?.focus();
        return;
      }

      if (e.key === 'Tab' && sidebarRef.current) {
        const focusableElements = sidebarRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const focusable = Array.from(focusableElements).filter(
          (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
        );

        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileOpen]);

  const closeMobileDrawer = React.useCallback(() => {
    setMobileOpen(false);
    toggleButtonRef.current?.focus();
  }, []);

  const activeItem = flatItems.find((item) => item.href === activeHref);

  // Quick light/dark header toggle cycle: light -> dark -> light
  const toggleHeaderTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  const toggleSubmenu = (itemName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setUserToggledParents((prev) => {
      const current =
        typeof prev[itemName] === 'boolean' ? prev[itemName] : Boolean(activeParentMap[itemName]);
      return {
        ...prev,
        [itemName]: !current,
      };
    });
  };

  return (
    <div className="pm-shell" data-theme={mounted ? resolvedTheme : 'light'}>
      {/* Brand custom CSS overrides if provided */}
      {branding?.themeCss && (
        <style id="org-brand-theme" dangerouslySetInnerHTML={{ __html: branding.themeCss }} />
      )}

      {/* Mobile scrim overlay */}
      {mobileOpen && <div className="pm-scrim" onClick={closeMobileDrawer} aria-hidden="true" />}

      {/* Bento Sidebar Rail */}
      <aside
        ref={sidebarRef}
        className="ps"
        data-mode={collapsed ? 'compact' : 'expanded'}
        data-mobile-open={mobileOpen ? 'true' : undefined}
        aria-label="Main navigation"
      >
        <div className="ps-inner">
          {/* Brand header */}
          <div className="ps-brand">
            <div className="ps-brand__meta">
              <div className="ps-brand__logo" aria-hidden="true">
                {(branding?.brandName ?? 'A')[0].toUpperCase()}
              </div>
              {(!collapsed || mobileOpen) && (
                <div className="ps-brand__text">
                  <span className="ps-brand__name">{branding?.brandName ?? 'AgencyOS'}</span>
                  <span className="ps-brand__role">Workspace</span>
                </div>
              )}
            </div>

            {/* Mobile close button */}
            <button
              ref={closeButtonRef}
              type="button"
              className="p-1 rounded text-muted-foreground hover:text-foreground md:hidden flex items-center justify-center"
              onClick={closeMobileDrawer}
              aria-label="Close navigation drawer"
              title="Close navigation drawer"
            >
              <X size={18} />
            </button>

            {/* Collapse toggle (desktop only) */}
            <button
              type="button"
              className="p-1 rounded text-muted-foreground hover:text-foreground hidden md:flex items-center justify-center"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>

          {/* Scrollable Navigation Sections */}
          <nav className="ps-nav" aria-label="Sections">
            {sections.map((section) => (
              <div key={section.id} className="ps-section">
                {(!collapsed || mobileOpen) && (
                  <div className="ps-section__label">{section.label}</div>
                )}
                <div className="flex flex-col gap-1">
                  {section.items.map((item: NavItem) => {
                    const Icon = NAV_ICONS[item.icon];
                    const expanded = isParentExpanded(item.name);
                    const hasSubItems = Boolean(item.subItems && item.subItems.length > 0);
                    const isDirectActive = activeHref === item.href;
                    const isSubActive = Boolean(item.subItems?.some((s) => s.href === activeHref));

                    return (
                      <div key={item.name} className="flex flex-col">
                        <div className="flex items-center">
                          <NextLink
                            href={item.href}
                            className="ps-item"
                            aria-current={isDirectActive ? 'page' : undefined}
                            data-active={isSubActive || isDirectActive ? 'true' : undefined}
                            title={item.name}
                            onClick={() => {
                              if (mobileOpen) closeMobileDrawer();
                              if (hasSubItems && !collapsed) {
                                setUserToggledParents((prev) => ({
                                  ...prev,
                                  [item.name]: true,
                                }));
                              }
                            }}
                          >
                            <span className="ps-item__icon" aria-hidden="true">
                              <Icon className="w-4 h-4" />
                            </span>
                            {(!collapsed || mobileOpen) && (
                              <span className="ps-item__label">{item.name}</span>
                            )}
                            {hasSubItems && (!collapsed || mobileOpen) && (
                              <button
                                type="button"
                                className="ps-item__toggle"
                                onClick={(e) => toggleSubmenu(item.name, e)}
                                aria-label={expanded ? 'Collapse submenu' : 'Expand submenu'}
                                tabIndex={-1}
                              >
                                <ChevronDown
                                  size={13}
                                  className={`transition-transform duration-150 ${
                                    expanded ? 'rotate-180' : ''
                                  }`}
                                />
                              </button>
                            )}
                          </NextLink>
                        </div>

                        {/* Collapsible Sub-Items */}
                        {hasSubItems && expanded && (!collapsed || mobileOpen) && (
                          <div
                            className="ps-subnav"
                            role="group"
                            aria-label={`${item.name} sub-items`}
                          >
                            {item.subItems!.map((sub) => {
                              const isSubItemActive = activeHref === sub.href;
                              return (
                                <NextLink
                                  key={sub.href}
                                  href={sub.href}
                                  className="ps-subitem"
                                  aria-current={isSubItemActive ? 'page' : undefined}
                                  onClick={() => {
                                    if (mobileOpen) closeMobileDrawer();
                                  }}
                                >
                                  <span>{sub.name}</span>
                                </NextLink>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Fixed Sidebar Footer: Settings & User Account Menu */}
          <div className="ps-foot">
            <NextLink
              href="/settings"
              className="ps-item"
              aria-current={activeHref === '/settings' ? 'page' : undefined}
              title="Settings & Preferences"
              onClick={() => {
                if (mobileOpen) closeMobileDrawer();
              }}
            >
              <span className="ps-item__icon" aria-hidden="true">
                <Settings className="w-4 h-4" />
              </span>
              {(!collapsed || mobileOpen) && <span className="ps-item__label">Settings</span>}
            </NextLink>

            <div className="flex items-center justify-between pt-1 border-t border-border/50">
              <div className="ps-user">
                <Avatar name={user.name ?? user.email ?? 'Member'} size="sm" />
                {(!collapsed || mobileOpen) && (
                  <div className="ps-user__info">
                    <span className="ps-user__name">{user.name ?? 'Member'}</span>
                    <span className="ps-user__email">{user.email ?? ''}</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-danger flex items-center justify-center shrink-0"
                onClick={async () => {
                  await signOut();
                  router.push('/login');
                }}
                aria-label="Sign out"
                title="Sign out of workspace"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Canvas Area */}
      <div className="pm-canvas" aria-hidden={mobileOpen ? 'true' : undefined}>
        <div className="pm-main">
          {/* Topbar with Global Header Quick Light/Dark Toggle */}
          <header className="pm-topbar">
            <div className="pm-topbar__left">
              {/* Mobile menu button */}
              <button
                ref={toggleButtonRef}
                type="button"
                className="md:hidden p-1.5 rounded text-muted-foreground hover:text-foreground"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label="Toggle navigation drawer"
                aria-expanded={mobileOpen}
              >
                <Menu size={18} />
              </button>

              <span className="pm-topbar__title">{activeItem?.name ?? 'AgencyOS'}</span>
              <span className="pm-topbar__meta">
                <span>/</span>
                <span>{branding?.brandName ?? 'Workspace'}</span>
              </span>
            </div>

            <div className="pm-topbar__right flex items-center gap-2.5">
              <div className="text-xs text-muted-foreground hidden sm:block mr-1">
                ⌘K Quick Jump
              </div>

              {/* Global Header Notifications Bell */}
              <NextLink
                href="/automation/notifications"
                className="relative p-1.5 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors flex items-center justify-center"
                aria-label={
                  unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'
                }
                title="Notifications"
              >
                <Bell size={15} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-foreground px-1 shadow-xs">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </NextLink>

              {/* Global Theme Toggle with Hydration Stability */}
              <button
                type="button"
                onClick={toggleHeaderTheme}
                className="p-1.5 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors flex items-center justify-center"
                aria-label={
                  mounted && resolvedTheme === 'dark'
                    ? 'Switch to light mode'
                    : 'Switch to dark mode'
                }
                title={
                  mounted
                    ? theme === 'system'
                      ? `Theme: System (${resolvedTheme}) — click to toggle`
                      : `Theme: ${theme === 'dark' ? 'Dark' : 'Light'} — click to toggle`
                    : 'Toggle theme mode'
                }
              >
                {mounted && resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
            </div>
          </header>

          {/* Page Body Viewport */}
          <main className="pm-body" id="main-content">
            {children}
          </main>
        </div>
      </div>

      <Toaster />
      <SonnerToaster richColors closeButton position="top-right" />
    </div>
  );
}
