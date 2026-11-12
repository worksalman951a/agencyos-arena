/**
 * Authenticated module shell (server component).
 *
 * Validates the Better Auth session against the database, resolves the actor's
 * permission codes for their organization, filters the shared navigation down to
 * what they may actually use, and evaluates the organization-scoped Bento shell flag.
 *
 * If `bento_shell` is enabled for this organization, renders `BentoAppShell`.
 * Otherwise, defaults safely to the established legacy `AppShell`.
 */

import { redirect } from 'next/navigation';

import { getCurrentPermissions, getSessionUser } from '@/lib/current-user';
import { getBranding } from '@/lib/services/settings/branding-service';
import { filterNavigation, NAV_SECTIONS } from '@/lib/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { BentoAppShell } from '@/components/layout/bento-app-shell';
import { isBentoShellEnabled } from '@/components/layout/bento-shell-eval';
import { requireOrganization } from '@/lib/permissions';
import { BentoShellProvider } from '@/components/providers/bento-theme-provider';

export async function ModuleShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    redirect('/login');
  }

  // Resolve organization ID safely from trusted session context
  let organizationId: string | null = null;
  try {
    const org = await requireOrganization(user.id);
    organizationId = org.organizationId;
  } catch {
    organizationId = null;
  }

  const [permissions, branding, bentoEnabled] = await Promise.all([
    getCurrentPermissions(),
    getBranding(),
    isBentoShellEnabled(organizationId),
  ]);

  const sections = filterNavigation(NAV_SECTIONS, permissions);

  // If organization has bento_shell enabled, render the Premium Bento layout
  if (bentoEnabled) {
    return (
      <BentoShellProvider isBento={true}>
        <BentoAppShell user={user} sections={sections} branding={branding}>
          {children}
        </BentoAppShell>
      </BentoShellProvider>
    );
  }

  // Default secure fallback: render existing verified AppShell
  return (
    <BentoShellProvider isBento={false}>
      <AppShell user={user} sections={sections} branding={branding}>
        {children}
      </AppShell>
    </BentoShellProvider>
  );
}
