/**
 * Forgot-password page (public).
 *
 * One form for both audiences: internal team members and Client Portal
 * identities use the same Better Auth e-mail/password credential, and the
 * server answers identically either way. Saying which kind of account an
 * address belongs to would be enumeration.
 */

import Link from 'next/link';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata = {
  title: 'Forgot password · AgencyOS',
  // No token is on this page, but keep the policy consistent with the reset
  // page: never send the URL anywhere in a Referer header.
  referrer: 'no-referrer' as const,
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-8">
        <div>
          <h1 className="text-2xl font-bold">Forgot your password?</h1>
          <p className="text-sm text-muted-foreground">
            Enter the e-mail address you sign in with. If an account exists, we will send a link to
            choose a new password.
          </p>
        </div>

        <ForgotPasswordForm />

        <p className="text-xs text-muted-foreground">
          Remembered it?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
          . Client portal user?{' '}
          <Link href="/portal/login" className="text-accent hover:underline">
            Portal sign-in
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
