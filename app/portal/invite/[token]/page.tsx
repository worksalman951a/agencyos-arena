/**
 * Client-portal invitation acceptance page.
 *
 * Server-rendered from the token: shows which agency invited the client and what
 * the invitation allows. Acceptance requires a signed-in session whose e-mail
 * matches the invitation, so a leaked link alone cannot become a portal login.
 */

import Link from 'next/link';

import { AcceptInvitationButton } from '@/components/portal/accept-invitation-button';
import { PortalLoginForm } from '@/components/portal/portal-login-form';
import { RequestEmailVerificationButton } from '@/components/auth/request-email-verification-button';
import { getSessionUser } from '@/lib/current-user';
import { getClientInvitationByToken } from '@/lib/services/portal/client-invitation-service';

export const dynamic = 'force-dynamic';

export default async function PortalInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let invitation: Awaited<ReturnType<typeof getClientInvitationByToken>> | null = null;
  let problem: string | null = null;

  try {
    invitation = await getClientInvitationByToken(token);
  } catch (error) {
    problem = (error as Error).message;
  }

  const session = await getSessionUser();
  const emailMatches =
    invitation && session?.email
      ? session.email.trim().toLowerCase() === invitation.email.trim().toLowerCase()
      : false;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-8">
        <h1 className="text-2xl font-bold">Client portal invitation</h1>

        {problem ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {problem}
            <p className="mt-2 text-xs">
              Invitations expire after 7 days and can be revoked by the agency. Ask your contact for
              a new one if you need it.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              <strong>{invitation!.organizationName}</strong> invited{' '}
              <strong>{invitation!.contactName || invitation!.email}</strong> to their client
              portal. The invitation was sent to {invitation!.email}.
            </p>

            {invitation!.capabilities.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                This invitation allows you to: {invitation!.capabilities.join(', ')}.
              </p>
            ) : null}

            {!session ? (
              <div className="space-y-2">
                <p className="text-sm">
                  Sign in (or create a password) with {invitation!.email} to continue. If this
                  account is not verified yet, verify ownership before accepting.
                </p>
                <PortalLoginForm
                  initialEmail={invitation!.email}
                  redirectTo={`/portal/invite/${token}`}
                />
                <p className="text-xs text-muted-foreground">
                  Use the same e-mail address the invitation was sent to.
                </p>
              </div>
            ) : !emailMatches ? (
              <p
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                You are signed in as {session.email}, but this invitation was issued to{' '}
                {invitation!.email}. Sign in with that address to accept.
              </p>
            ) : !session.emailVerified ? (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <p>Verify ownership of this email address before accepting the invitation.</p>
                <RequestEmailVerificationButton email={session.email ?? invitation!.email} />
              </div>
            ) : (
              <AcceptInvitationButton token={token} />
            )}
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Agency team member?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Team sign-in
          </Link>
        </p>
      </div>
    </div>
  );
}
