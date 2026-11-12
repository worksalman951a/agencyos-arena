/**
 * Client-portal workspace layout.
 *
 * Resolves the portal identity for this request and renders the portal shell. A
 * suspended or revoked access (403) redirects to the portal login, where the
 * reason is explained; an internal team member who lands here is sent back to the
 * team application instead of being shown an empty client workspace.
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PortalShell } from '@/components/portal/portal-shell';
import { capabilityFlags, getPortalAccessOrNull } from '@/lib/portal/access-control';

export default async function PortalWorkspaceLayout({ children }: { children: React.ReactNode }) {
  let context = null;

  try {
    context = await getPortalAccessOrNull();
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 403) {
      redirect('/portal/login?reason=inactive');
    }
    throw error;
  }

  if (!context) {
    redirect('/portal/login');
  }

  return (
    <PortalShell
      organizationName={context.organizationName}
      clientName={context.contactName}
      capabilities={capabilityFlags(context)}
    >
      {children}
      <p className="mt-8 text-xs text-muted-foreground">
        Need a team workspace?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Team sign-in
        </Link>
      </p>
    </PortalShell>
  );
}
