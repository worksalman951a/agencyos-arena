'use client';

/**
 * AgencyOS application shell.
 *
 * The one and only layout frame for authenticated pages: sidebar + top nav +
 * main content area + toast outlets. Every module layout renders this through
 * the server-side ModuleShell wrapper, so navigation, active states, responsive
 * behaviour (desktop collapse, mobile drawer) and toast rendering are identical
 * everywhere. Modules must never render their own header/sidebar.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Toaster as SonnerToaster } from 'sonner';
import { signOut } from '@/lib/auth-client';
import { Sidebar } from '@/components/layout/sidebar';
import { TopNav } from '@/components/layout/top-nav';
import { Toaster } from '@/components/ui/toaster';
import { useTheme } from '@/components/providers/theme-provider';
import { classNames } from '@/lib/utils';
import { BrandingProvider } from '@/components/providers/branding-provider';
import type { BrandContext } from '@/lib/services/settings/branding-service';
import type { NavSection } from '@/lib/navigation';
import { RequestEmailVerificationButton } from '@/components/auth/request-email-verification-button';

interface ShellUser {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
}

interface AppShellProps {
  children: React.ReactNode;
  user: ShellUser;
  /** Navigation already filtered for this user's permissions. */
  sections: readonly NavSection[];
  /** Organization branding resolved for this request (null when unauthenticated). */
  branding?: BrandContext | null;
}

export function AppShell({ children, user, sections, branding }: AppShellProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = React.useState(false);
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  const shell = (
    <div className="flex h-screen bg-canvas text-foreground">
      {/* Brand tokens last in the document so they win over the compiled
          stylesheet for equal specificity. Only accent/primary/ring (and their
          foregrounds) are overridden — semantic colours are never touched. */}
      {branding && (
        <style
          id="org-brand-theme"
          // Generated from validated hex colours only (lib/branding.ts), never user HTML.
          dangerouslySetInnerHTML={{ __html: branding.themeCss }}
        />
      )}
      <Sidebar
        brandName={branding?.brandName ?? 'AgencyOS'}
        logoUrl={branding?.logoUrl ?? null}
        sections={sections}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        isOpen={isMobileDrawerOpen}
        setIsOpen={setIsMobileDrawerOpen}
      />
      <div
        className={classNames(
          'flex-1 flex flex-col overflow-hidden',
          isSidebarCollapsed ? 'sm:pl-16' : 'sm:pl-64'
        )}
      >
        <TopNav
          toggleMobileSidebar={() => setIsMobileDrawerOpen(!isMobileDrawerOpen)}
          isMobileSidebarOpen={isMobileDrawerOpen}
          user={{
            name: user.name ?? null,
            email: user.email ?? null,
          }}
          onSignOut={async () => {
            await signOut();
            router.push('/login');
          }}
          theme={theme as 'light' | 'dark' | 'system'}
          setTheme={setTheme}
        />
        <main className="flex-1 overflow-y-auto bg-canvas p-6">
          {!user.emailVerified && user.email ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <p>Your email address has not been verified. Existing access is unchanged.</p>
              <RequestEmailVerificationButton email={user.email} />
            </div>
          ) : null}
          {children}
        </main>
      </div>
      {isMobileDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm sm:hidden"
          onClick={() => setIsMobileDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Two toast systems are in use across the app (the shadcn-style
          useToast hook and `sonner`). Both outlets live here so a toast raised
          on any page is actually rendered - previously the sonner outlet was
          never mounted and ~20 pages' success/error messages were dropped. */}
      <Toaster />
      <SonnerToaster richColors closeButton position="top-right" />
    </div>
  );

  return branding ? <BrandingProvider branding={branding}>{shell}</BrandingProvider> : shell;
}
