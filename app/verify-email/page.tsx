import type { Metadata } from 'next';
import Link from 'next/link';
import { VerifyEmailForm } from '@/components/auth/verify-email-form';

export const metadata: Metadata = {
  title: 'Verify your email | AgencyOS',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <section className="w-full max-w-md space-y-4 rounded-lg border bg-background p-8">
        <h1 className="text-2xl font-bold">Verify your email address</h1>
        <VerifyEmailForm />
        <p className="text-xs text-muted-foreground">
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
