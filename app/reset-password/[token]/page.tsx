/**
 * Reset-password page (public).
 *
 * The token is part of the path so a mail client can make it a link; the page
 * is `no-referrer` so following any other link from it cannot leak the token in
 * a Referer header. The form sends the token in a POST body.
 *
 * The page does not consult the database to decide whether the token is live:
 * a GET must not spend or validate a credential, and the form would otherwise
 * be an oracle. The atomic consume happens in the POST, where single use can
 * be enforced. A malformed token is rejected here only because it cannot be one
 * of ours.
 */

import Link from 'next/link';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { isPasswordResetToken } from '@/lib/auth/password-reset-policy';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Choose a new password · AgencyOS',
  referrer: 'no-referrer' as const,
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const usable = isPasswordResetToken(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-8">
        <div>
          <h1 className="text-2xl font-bold">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            This link can be used once. Changing your password signs out every other session.
          </p>
        </div>

        {usable ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <p>This password reset link is invalid or has expired.</p>
            <Link href="/forgot-password" className="underline">
              Request a new link
            </Link>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
