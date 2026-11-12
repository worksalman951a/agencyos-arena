/**
 * Client-portal application shell (server component).
 *
 * Deliberately separate from the internal `AppShell`: a client session must never
 * see internal navigation, module names or teammate affordances. The only links
 * rendered are the portal's own, filtered by the capability flags on the client's
 * access row (which the service layer enforces again on every request).
 */

import Link from 'next/link';

import type { ClientCapabilityFlags } from '@/lib/portal/capabilities';
import { RequestEmailVerificationButton } from '@/components/auth/request-email-verification-button';

const PORTAL_NAV: Array<{ label: string; href: string; capability?: keyof ClientCapabilityFlags }> =
  [
    { label: 'Overview', href: '/portal' },
    { label: 'Projects', href: '/portal/projects' },
    { label: 'Documents', href: '/portal/documents' },
    { label: 'Approvals', href: '/portal/approvals' },
    { label: 'Notifications', href: '/portal/notifications' },
  ];

export interface PortalShellProps {
  organizationName: string;
  clientName: string;
  capabilities: ClientCapabilityFlags;
  email: string;
  emailVerified: boolean;
  children: React.ReactNode;
}

export function PortalShell({
  organizationName,
  clientName,
  capabilities,
  email,
  emailVerified,
  children,
}: PortalShellProps) {
  const items = [
    ...PORTAL_NAV,
    ...(capabilities.canViewInvoices ? [{ label: 'Invoices', href: '/portal/invoices' }] : []),
  ];

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Client portal</p>
            <h1 className="text-lg font-semibold">{organizationName}</h1>
          </div>
          <div className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{clientName}</span>
            <Link href="/portal/login" className="ml-3 text-accent hover:underline">
              Switch account
            </Link>
          </div>
        </div>
        <nav aria-label="Client portal" className="mx-auto max-w-6xl px-4">
          <ul className="flex flex-wrap gap-1 pb-2">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex items-center rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {!emailVerified ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>Your email address has not been verified. Portal access is unchanged.</p>
            <RequestEmailVerificationButton email={email} />
          </div>
        ) : null}
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground">
        You are viewing only the items your agency has explicitly shared with you.
      </footer>
    </div>
  );
}
