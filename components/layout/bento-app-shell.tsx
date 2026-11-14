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
  User,
  X,
} from 'lucide-react';
import { Toaster as SonnerToaster } from 'sonner';
import { Toaster } from '@/components/ui/toaster';
import { signOut } from '@/lib/auth-client';
import { useTheme } from '@/components/providers/theme-provider';
import { NAV_ICONS } from '@/components/layout/nav-icons';
import { Avatar } from '@/components/ui/premium/primitives';
import {
  allNavItems,
  isHrefActive,
  navPath,
  primaryNavHref,
  resolveActiveHref,
  type NavSection,
  type NavItem,
} from '@/lib/navigation';
import {
  HASH_NAVIGATION_EVENT,
  hashFromEvent,
  hashFromHref,
  notifyHashNavigation,
} from '@/lib/hash-navigation';
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
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false);
  const profileMenuRef = React.useRef<HTMLDivElement | null>(null);

  // Close profile dropdown when clicking outside or pressing Escape
  React.useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileMenuOpen]);
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

  // Fragments select a panel inside a page (e.g. /settings#branding) and must
  // participate in active-link resolution. Native hashchange/popstate cover
  // direct loads, reloads and back/forward; sidebar links announce themselves
  // because Next's history.pushState does not emit hashchange.
  const [hash, setHash] = React.useState('');
  React.useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    const syncFromNavigation = (event: Event) => setHash(hashFromEvent(event));
    syncHash();
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
    window.addEventListener(HASH_NAVIGATION_EVENT, syncFromNavigation);
    return () => {
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener('popstate', syncHash);
      window.removeEventListener(HASH_NAVIGATION_EVENT, syncFromNavigation);
    };
  }, [pathname]);

  const flatItems = React.useMemo(() => allNavItems(sections), [sections]);
  const activeHref = resolveActiveHref(`${pathname ?? ''}${hash}`, flatItems);
  // Pathname-only variant used for sub-item highlighting (fragment links match exactly).
  const activePath = navPath(activeHref ?? pathname ?? '');

  // Manual expand/collapse state, scoped to the route it was made on. A new
  // navigation starts from the active group again instead of carrying stale
  // open/closed state across pages.
  const [userToggles, setUserToggles] = React.useState<{
    pathname: string;
    parents: Record<string, boolean>;
  }>({ pathname: '', parents: {} });

  // Auto-expand any group containing the active sub-item
  const activeParentMap = React.useMemo(() => {
    const map: Record<string, boolean> = {};
    if (!pathname) return map;
    for (const sec of sections) {
      for (const item of sec.items) {
        if (item.subItems?.some((sub) => isHrefActive(pathname, sub.href))) {
          map[item.name] = true;
        }
      }
    }
    return map;
  }, [sections, pathname]);

  const currentPath = pathname ?? '';

  const isParentExpanded = React.useCallback(
    (itemName: string) => {
      const toggled =
        userToggles.pathname === currentPath ? userToggles.parents[itemName] : undefined;
      if (typeof toggled === 'boolean') return toggled;
      // Parents of the active route are always expanded on arrival.
      return Boolean(activeParentMap[itemName]);
    },
    [userToggles, currentPath, activeParentMap]
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

  const setParentExpanded = (itemName: string, expanded: boolean) => {
    setUserToggles((prev) => {
      const parents = prev.pathname === currentPath ? prev.parents : {};
      return { pathname: currentPath, parents: { ...parents, [itemName]: expanded } };
    });
  };

  const toggleSubmenu = (itemName: string) => {
    setParentExpanded(itemName, !isParentExpanded(itemName));
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
              className={`p-1 rounded text-muted-foreground hover:text-foreground hidden md:flex items-center justify-center ${
                collapsed ? 'ps-brand__collapse-btn' : ''
              }`}
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={16} />}
            </button>
          </div>

          {/* Scrollable Navigation Sections */}
          <nav className="ps-nav" aria-label="Sections">
            {sections.map((section) => (
              <div key={section.id} className="ps-section">
                {section.label && (!collapsed || mobileOpen) && (
                  <div className="ps-section__label">{section.label}</div>
                )}
                <div className="flex flex-col gap-1">
                  {section.items.map((item: NavItem) => {
                    const Icon = NAV_ICONS[item.icon];
                    const expanded = isParentExpanded(item.name);
                    const hasSubItems = Boolean(item.subItems && item.subItems.length > 0);
                    const labelsVisible = !collapsed || mobileOpen;
                    const href = primaryNavHref(item);
                    const onLanding = activePath === navPath(href);
                    const isDirectActive = !hasSubItems && onLanding;
                    const isSubActive = Boolean(
                      item.subItems?.some(
                        (sub) =>
                          activeHref === sub.href ||
                          (!sub.href.includes('#') && isHrefActive(activePath, sub.href))
                      )
                    );
                    const subnavId = `ps-subnav-${section.id}-${item.name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')}`;

                    return (
                      <div key={item.name} className="flex flex-col">
                        {item.dividerBefore && (
                          <div className="ps-divider" role="separator" aria-hidden="true" />
                        )}
                        <div className="ps-item-row">
                          <NextLink
                            href={href}
                            className="ps-item"
                            aria-current={isDirectActive ? 'page' : undefined}
                            data-active={isSubActive || onLanding ? 'true' : undefined}
                            data-variant={item.accent}
                            title={item.name}
                            onClick={() => {
                              if (mobileOpen) closeMobileDrawer();
                              if (hasSubItems && labelsVisible) {
                                setParentExpanded(item.name, true);
                              }
                            }}
                          >
                            <span className="ps-item__icon" aria-hidden="true">
                              <Icon className="w-4 h-4" />
                            </span>
                            {labelsVisible && <span className="ps-item__label">{item.name}</span>}
                          </NextLink>
                          {hasSubItems && labelsVisible && (
                            <button
                              type="button"
                              className="ps-item__toggle"
                              onClick={() => toggleSubmenu(item.name)}
                              aria-expanded={expanded}
                              aria-controls={subnavId}
                              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.name} submenu`}
                              title={`${expanded ? 'Collapse' : 'Expand'} ${item.name}`}
                            >
                              <ChevronDown
                                size={13}
                                className={`transition-transform duration-150 ${
                                  expanded ? 'rotate-180' : ''
                                }`}
                              />
                            </button>
                          )}
                        </div>

                        {/* Collapsible Sub-Items */}
                        {hasSubItems && expanded && labelsVisible && (
                          <div
                            className="ps-subnav"
                            id={subnavId}
                            role="group"
                            aria-label={`${item.name} sub-items`}
                          >
                            {item.subItems!.map((sub) => {
                              const isSubItemActive =
                                activeHref === sub.href ||
                                (!sub.href.includes('#') && isHrefActive(activePath, sub.href));
                              return (
                                <NextLink
                                  key={sub.href}
                                  href={sub.href}
                                  className="ps-subitem"
                                  aria-current={isSubItemActive ? 'page' : undefined}
                                  onClick={() => {
                                    if (mobileOpen) closeMobileDrawer();
                                    const fragment = hashFromHref(sub.href);
                                    if (fragment) notifyHashNavigation(fragment);
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

          {/* Fixed Sidebar Footer: User Account Menu */}
          <div className="ps-foot" ref={profileMenuRef}>
            {/* User Profile / Account Footer */}
            {collapsed && !mobileOpen ? (
              /* Collapsed rail: Only centered avatar button triggering accessible account menu */
              <div className="relative flex justify-center py-1">
                <button
                  type="button"
                  className="ps-user-btn"
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  aria-label="User account menu"
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="true"
                  title={user.name ?? user.email ?? 'User account'}
                >
                  <Avatar
                    name={(user.name || user.email || 'M').charAt(0).toUpperCase()}
                    size="sm"
                  />
                </button>

                {profileMenuOpen && (
                  <div className="ps-profile-popover" role="menu" aria-label="User account menu">
                    <div className="px-3 py-2 border-b border-border/60">
                      <div className="text-xs font-semibold text-foreground truncate">
                        {user.name ?? 'Member'}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {user.email ?? ''}
                      </div>
                    </div>
                    <div className="p-1 space-y-0.5">
                      <NextLink
                        href="/settings#profile"
                        role="menuitem"
                        className="ps-profile-menuitem"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          notifyHashNavigation('#profile');
                        }}
                      >
                        <User className="w-3.5 h-3.5" />
                        <span>My Profile</span>
                      </NextLink>
                      <NextLink
                        href="/settings"
                        role="menuitem"
                        className="ps-profile-menuitem"
                        onClick={() => setProfileMenuOpen(false)}
                      >
                        <Settings className="w-3.5 h-3.5" />
                        <span>Settings</span>
                      </NextLink>
                      <button
                        type="button"
                        role="menuitem"
                        className="ps-profile-menuitem ps-profile-menuitem--danger"
                        onClick={async () => {
                          setProfileMenuOpen(false);
                          await signOut();
                          router.push('/login');
                        }}
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Expanded rail: Full user info with inline sign-out */
              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <div className="ps-user">
                  <Avatar name={user.name ?? user.email ?? 'Member'} size="sm" />
                  <div className="ps-user__info">
                    <span className="ps-user__name">{user.name ?? 'Member'}</span>
                    <span className="ps-user__email">{user.email ?? ''}</span>
                  </div>
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
            )}
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
