/**
 * Client portal login.
 *
 * Public page (no layout guard): it must render for a client who has a session
 * but no access yet, and explain why a suspended/revoked client was redirected
 * here. `reason=inactive` is a UI hint only — authorization is decided server-side
 * in lib/portal/access-control.ts.
 */

import Link from 'next/link';

import { PortalLoginForm } from '@/components/portal/portal-login-form';

export const dynamic = 'force-dynamic';

const REASON_TEXT: Record<string, string> = {
  inactive:
    'That account no longer has active portal access. Sign in with the account your agency invited, or contact them.',
};

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; email?: string }>;
}) {
  const { reason, email } = await searchParams;
  const notice = reason ? REASON_TEXT[reason] : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-8">
        <div>
          <h1 className="text-2xl font-bold">Client portal</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with the e-mail address your agency invited.
          </p>
        </div>

        {notice ? (
          <p
            role="alert"
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {notice}
          </p>
        ) : null}

        <PortalLoginForm initialEmail={email ?? ''} />

        <p className="text-xs text-muted-foreground">
          Agency team member?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Sign in to the workspace
          </Link>
        </p>
      </div>
    </div>
  );
}
