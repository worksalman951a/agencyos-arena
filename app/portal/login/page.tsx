'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, Mail, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PortalLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; error?: boolean } | null>(null);

  // Auto-verify if token is in fragment (#token=...) or query param (?token=...)
  React.useEffect(() => {
    let tokenFromHash: string | null = null;
    if (typeof window !== 'undefined' && window.location.hash) {
      const match = window.location.hash.match(/[#&]token=([^&]+)/);
      if (match && match[1]) {
        tokenFromHash = decodeURIComponent(match[1]);
        // Immediately sanitize window location to remove token from browser history
        window.history.replaceState(null, '', window.location.pathname);
      }
    }

    const token = tokenFromHash || searchParams.get('token');
    if (!token) return;

    let active = true;

    async function verify() {
      setSubmitting(true);
      setMessage({ text: 'Verifying your client access token…' });

      try {
        const res = await fetch('/api/v1/portal/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Verification failed');
        if (active) {
          setMessage({ text: 'Access verified! Opening your workspace…' });
          router.push('/portal');
        }
      } catch (err) {
        if (active) {
          setMessage({ text: (err as Error).message, error: true });
          setSubmitting(false);
        }
      }
    }

    void verify();

    return () => {
      active = false;
    };
  }, [searchParams, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch('/api/v1/portal/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      setMessage({
        text:
          data.message || 'If an authorized portal account exists, a sign-in link has been sent.',
      });
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <div className="inline-flex p-3 rounded-xl bg-accent/10 text-accent mb-2">
          <ShieldCheck size={32} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Client Portal</h1>
        <p className="text-xs text-muted-foreground">
          Secure, authenticated access to your proposals, contracts, invoices, and project
          deliverables.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-background border border-border shadow-xs rounded-xl p-6 sm:p-8 space-y-6">
          {message && (
            <div
              className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                message.error
                  ? 'border border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              }`}
            >
              {message.error ? (
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-semibold text-foreground">
                Authorized Client Email
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  placeholder="name@company.com"
                  className="w-full bg-background border border-input rounded-md pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <Mail
                  size={14}
                  className="absolute left-3 top-2.5 text-muted-foreground opacity-70"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Enter the email address invited by your agency account team.
              </p>
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="w-full text-xs font-semibold bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {submitting ? 'Verifying…' : 'Send Sign-In Link'}
              <ArrowRight size={13} className="ml-1.5" />
            </Button>
          </form>

          <div className="border-t border-border pt-4 text-center">
            <p className="text-[11px] text-muted-foreground">
              Portal access is provisioned by organization administrators. If you have not yet
              received an invitation, contact your account manager.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
