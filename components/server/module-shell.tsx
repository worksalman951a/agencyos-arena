/**
 * Authenticated module shell (server component).
 *
 * Validates the Better Auth session against the database, resolves the actor's
 * permission codes for their organization, filters the shared navigation down to
 * what they may actually use, and renders the single AppShell.
 *
 * Every top-level module layout (admin, automation, crm, dashboard, documents,
 * finance, projects, sales, settings) delegates here, so there is one
 * implementation of the sidebar/header and one definition of "authenticated
 * page" instead of a copy per module.
 *
 * Session and permissions are request-cached in lib/current-user.ts, so pages
 * can reuse them without repeating the queries.
 *
 * redirect() throws, so children are never serialized for an invalid session.
 */

import { redirect } from 'next/navigation';

import { getCurrentPermissions, getSessionUser } from '@/lib/current-user';
import { getBranding } from '@/lib/services/settings/branding-service';
import { filterNavigation, NAV_SECTIONS } from '@/lib/navigation';
import { AppShell } from '@/components/layout/app-shell';

export async function ModuleShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    redirect('/login');
  }

  // Client-portal identities live in a different surface entirely: they hold no
  // organization membership and no internal permissions, so every internal page
  // would answer 403. Send them to their own workspace instead of rendering a
  // shell with nothing in it.
  if (user.userType === 'client') {
    redirect('/portal');
  }

  const [permissions, branding] = await Promise.all([getCurrentPermissions(), getBranding()]);
  const sections = filterNavigation(NAV_SECTIONS, permissions);

  return (
    <AppShell user={user} sections={sections} branding={branding}>
      {children}
    </AppShell>
  );
}
