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
  Pin,
  PinOff,
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

const PIN_STORAGE_KEY = 'agencyos:sidebar:pinned';

export function BentoAppShell({ children, user, sections, branding }: BentoAppShellProps) {
  // Pinned state: true = always expanded (default), false = collapsed rail with hover-to-expand
  const [isPinned, setIsPinned] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = window.localStorage.getItem(PIN_STORAGE_KEY);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });
  const [isHovered, setIsHovered] = React.useState<boolean>(false);
  const [mobileOpen, setMobileOpen] = React.useState<boolean>(false);
  const [profileMenuOpen, setProfileMenuOpen] = React.useState<boolean>(false);
  const [unreadCount, setUnreadCount] = React.useState<number>(0);

  const profileMenuRef = React.useRef<HTMLDivElement | null>(null);
  const sidebarRef = React.useRef<HTMLElement | null>(null);
  const toggleButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const { theme, resolvedTheme, mounted, setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  const handleTogglePin = React.useCallback(() => {
    setIsPinned((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PIN_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

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
      if (typeof userToggledParents[itemName] === 'boolean') {
        return userToggledParents[itemName];
      }
      return Boolean(activeParentMap[itemName]);
    },
    [userToggledParents, activeParentMap]
  );

  // Escape key closes hover expand or profile popover
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (profileMenuOpen) {
          setProfileMenuOpen(false);
        } else if (isHovered && !isPinned) {
          setIsHovered(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [profileMenuOpen, isHovered, isPinned]);

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

  // Hover handlers for smooth hover expansion without layout shifting
  const handleMouseEnter = React.useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (!isPinned) {
      // Small debounce (60ms) prevents accidental fluttering
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovered(true);
      }, 60);
    }
  }, [isPinned]);

  const handleMouseLeave = React.useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (!isPinned) {
      // 180ms delay gives natural smooth glide when mouse momentarily strays
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovered(false);
        setProfileMenuOpen(false);
      }, 180);
    }
  }, [isPinned]);

  // Is the sidebar content visually expanded right now?
  // It is visually expanded if:
  // 1. Mobile drawer is open, OR
  // 2. Desktop is pinned, OR
  // 3. Desktop is hovered while unpinned
  const isVisuallyExpanded = mobileOpen || isPinned || isHovered;

  return (
    <div className="pm-shell" data-theme={mounted ? resolvedTheme : 'light'}>
      {/* Brand custom CSS overrides if provided */}
      {branding?.themeCss && (
        <style id="org-brand-theme" dangerouslySetInnerHTML={{ __html: branding.themeCss }} />
      )}

      {/* Mobile scrim overlay */}
      {mobileOpen && <div className="pm-scrim" onClick={closeMobileDrawer} aria-hidden="true" />}

      {/* Hover-expand backdrop scrim (subtle scrim when floating over main canvas in unpinned hover mode) */}
      {!isPinned && isHovered && !mobileOpen && (
        <div className="ps-floating-scrim" onClick={() => setIsHovered(false)} aria-hidden="true" />
      )}

      {/* Bento Sidebar Rail Container */}
      <div
        className="ps-wrapper"
        data-pinned={isPinned ? 'true' : 'false'}
        data-hovered={isHovered ? 'true' : 'false'}
        data-mobile-open={mobileOpen ? 'true' : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <aside
          ref={sidebarRef}
          className="ps"
          data-mode={isVisuallyExpanded ? 'expanded' : 'compact'}
          data-floating={!isPinned && isHovered && !mobileOpen ? 'true' : 'false'}
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
                {isVisuallyExpanded && (
                  <div className="ps-brand__text">
                    <span className="ps-brand__name">{branding?.brandName ?? 'AgencyOS'}</span>
                    <span className="ps-brand__role">Workspace</span>
                  </div>
                )}
              </div>

              {/* Mobile close button - rendered when mobile drawer is open */}
              {mobileOpen && (
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
              )}

              {/* Desktop Pin / Unpin & Collapse Controls */}
              <div className="hidden md:flex items-center gap-1">
                {isVisuallyExpanded && (
                  <button
                    type="button"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors flex items-center justify-center"
                    onClick={handleTogglePin}
                    aria-label={
                      isPinned ? 'Unpin sidebar (auto-collapse)' : 'Pin sidebar (keep open)'
                    }
                    title={isPinned ? 'Unpin sidebar (auto-collapse)' : 'Pin sidebar (keep open)'}
                  >
                    {isPinned ? (
                      <Pin className="w-3.5 h-3.5 rotate-45 text-accent" />
                    ) : (
                      <PinOff className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}

                {/* Direct Collapse/Expand Toggle Chevron */}
                <button
                  type="button"
                  className={`p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors flex items-center justify-center ${
                    !isVisuallyExpanded ? 'ps-brand__collapse-btn' : ''
                  }`}
                  onClick={() => {
                    if (isPinned) {
                      setIsPinned(false);
                      setIsHovered(false);
                      try {
                        localStorage.setItem(PIN_STORAGE_KEY, 'false');
                      } catch {}
                    } else {
                      setIsPinned(true);
                      setIsHovered(false);
                      try {
                        localStorage.setItem(PIN_STORAGE_KEY, 'true');
                      } catch {}
                    }
                  }}
                  aria-label={isPinned ? 'Collapse sidebar' : 'Expand & pin sidebar'}
                  title={isPinned ? 'Collapse sidebar' : 'Expand & pin sidebar'}
                >
                  {isVisuallyExpanded ? <ChevronLeft size={15} /> : <ChevronRight size={14} />}
                </button>
              </div>
            </div>

            {/* Scrollable Navigation Sections with Custom Smooth Scrollbar */}
            <nav className="ps-nav" aria-label="Sections">
              {sections.map((section) => (
                <div key={section.id} className="ps-section">
                  {isVisuallyExpanded ? (
                    <div className="ps-section__label">{section.label}</div>
                  ) : (
                    <div className="ps-section__divider" aria-hidden="true" />
                  )}

                  <div className="flex flex-col gap-1">
                    {section.items.map((item: NavItem) => {
                      const Icon = NAV_ICONS[item.icon];
                      const expanded = isParentExpanded(item.name);
                      const hasSubItems = Boolean(item.subItems && item.subItems.length > 0);
                      const isDirectActive = activeHref === item.href;
                      const isSubActive = Boolean(
                        item.subItems?.some((s) => s.href === activeHref)
                      );
                      const isParentActive = isDirectActive || isSubActive;

                      return (
                        <div key={item.name} className="flex flex-col">
                          <div className="flex items-center w-full">
                            <NextLink
                              href={item.href}
                              className={`ps-item ${
                                isParentActive ? 'ps-item--active' : ''
                              } ${hasSubItems && isVisuallyExpanded ? 'pr-8' : ''}`}
                              aria-current={isDirectActive ? 'page' : undefined}
                              data-active={isParentActive ? 'true' : undefined}
                              title={!isVisuallyExpanded ? item.name : undefined}
                              onClick={() => {
                                if (mobileOpen) closeMobileDrawer();
                              }}
                            >
                              <span className="ps-item__icon" aria-hidden="true">
                                <Icon className="w-4 h-4" />
                              </span>
                              {isVisuallyExpanded && (
                                <span className="ps-item__label">{item.name}</span>
                              )}

                              {/* Nested Submenu Toggle Chevron */}
                              {hasSubItems && isVisuallyExpanded && (
                                <button
                                  type="button"
                                  className="ps-item__toggle"
                                  onClick={(e) => toggleSubmenu(item.name, e)}
                                  aria-label={
                                    expanded ? `Collapse ${item.name}` : `Expand ${item.name}`
                                  }
                                  aria-expanded={expanded}
                                >
                                  <ChevronDown
                                    size={13}
                                    className={`ps-chevron-anim ${
                                      expanded ? 'ps-chevron-anim--open' : ''
                                    }`}
                                  />
                                </button>
                              )}
                            </NextLink>
                          </div>

                          {/* Animated Collapsible Sub-Items */}
                          {hasSubItems && isVisuallyExpanded && (
                            <div
                              className={`ps-subnav-container ${
                                expanded ? 'ps-subnav-container--open' : ''
                              }`}
                              role="group"
                              aria-label={`${item.name} sub-items`}
                            >
                              <div className="ps-subnav">
                                {item.subItems!.map((sub) => {
                                  const isSubItemActive = activeHref === sub.href;
                                  return (
                                    <NextLink
                                      key={sub.href}
                                      href={sub.href}
                                      className={`ps-subitem ${
                                        isSubItemActive ? 'ps-subitem--active' : ''
                                      }`}
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
            <div className="ps-foot" ref={profileMenuRef}>
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
                {isVisuallyExpanded && <span className="ps-item__label">Settings</span>}
              </NextLink>

              {/* User Profile / Account Footer */}
              {!isVisuallyExpanded ? (
                /* Collapsed rail: Centered avatar button triggering accessible account menu */
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
                          onClick={() => setProfileMenuOpen(false)}
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
                /* Expanded state: Full user info with inline sign-out */
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
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-danger flex items-center justify-center shrink-0 transition-colors"
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
      </div>

      {/* Main Canvas Area - Width/Margin adjusts strictly based on pinned state so hover does NOT shift layout! */}
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
