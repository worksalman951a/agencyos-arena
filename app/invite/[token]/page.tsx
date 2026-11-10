/**
 * Invitation acceptance page.
 *
 * Server-rendered from the token: shows which organization the invitation is
 * for and offers "Join". Acceptance requires a signed-in session whose e-mail
 * matches the invitation, so a leaked link alone cannot join a workspace.
 */

import Link from 'next/link';

import { getInvitationByToken } from '@/lib/services/admin/invitation-service';
import { getSessionUser } from '@/lib/current-user';
import { AcceptInvitationButton } from './AcceptInvitationButton';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let invitation: Awaited<ReturnType<typeof getInvitationByToken>> | null = null;
  let problem: string | null = null;
  try {
    invitation = await getInvitationByToken(token);
  } catch (error) {
    problem = (error as Error).message;
  }

  const session = await getSessionUser();

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-8 space-y-4">
        <h1 className="text-2xl font-bold">Organization invitation</h1>

        {problem ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {problem}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              You have been invited to join <strong>{invitation!.organizationName}</strong> as{' '}
              <strong>{invitation!.roleName}</strong>. The invitation was sent to{' '}
              {invitation!.email}.
            </p>

            {!session ? (
              <p className="text-sm">
                Please{' '}
                <Link href="/login" className="text-accent hover:underline">
                  sign in
                </Link>{' '}
                with {invitation!.email} to accept.
              </p>
            ) : session.email?.toLowerCase() !== invitation!.email.toLowerCase() ? (
              <p className="text-sm text-red-700">
                You are signed in as {session.email}, but this invitation was issued to{' '}
                {invitation!.email}.
              </p>
            ) : (
              <AcceptInvitationButton token={token} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
