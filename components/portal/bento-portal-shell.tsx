'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FileText, CreditCard, Briefcase, Layers, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ClientPortalContext } from '@/lib/services/portal/portal-auth-service';

interface BentoPortalShellProps {
  context: ClientPortalContext;
  children: React.ReactNode;
}

export function BentoPortalShell({ context, children }: BentoPortalShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = React.useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/v1/portal/auth', { method: 'DELETE' });
      router.push('/portal/login');
    } finally {
      setLoggingOut(false);
    }
  };

  const navItems = [
    { href: '/portal', label: 'Overview', icon: Layers, exact: true },
    { href: '/portal/documents', label: 'Proposals & Quotations', icon: FileText },
    { href: '/portal/invoices', label: 'Invoices & Billing', icon: CreditCard },
    { href: '/portal/projects', label: 'Active Projects', icon: Briefcase },
  ];

  return (
    <div className="min-h-screen bg-muted/20 text-foreground flex flex-col font-sans">
      {/* ── Top Portal Header ─────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-background border-b border-border shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center font-bold text-white text-sm shadow-xs"
              style={{ backgroundColor: context.organizationBrand.brandColor || '#0f172a' }}
            >
              {(context.organizationBrand.brandName || context.organizationName || 'P')
                .slice(0, 1)
                .toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <span>{context.organizationBrand.brandName || context.organizationName}</span>
                <span>•</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <ShieldCheck size={12} /> Client Portal
                </span>
              </div>
              <div className="text-sm font-bold text-foreground tracking-tight">
                {context.accountName
                  ? `${context.accountName} Workspace`
                  : `${context.contactName}'s Portal`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-semibold text-foreground">{context.contactName}</div>
              <div className="text-[11px] text-muted-foreground">{context.email}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={loggingOut}
              className="text-xs h-8 text-muted-foreground hover:text-foreground"
            >
              <LogOut size={13} className="mr-1.5" />
              Sign Out
            </Button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-t border-border/60 bg-background/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-1 overflow-x-auto py-1">
            {navItems.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-accent/10 text-accent font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  }`}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      {/* ── Main Content Area ─────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {children}
      </main>

      {/* ── Client Portal Footer ──────────────────────────────────── */}
      <footer className="border-t border-border bg-background py-4 text-xs text-muted-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Secure Client Workspace for {context.contactName} ({context.email})
          </span>
          <span>Powered by AgencyOS Studio</span>
        </div>
      </footer>
    </div>
  );
}
