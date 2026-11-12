'use client';

import * as React from 'react';

/** The fragment is read and redeemed only after an explicit user action. */
export function VerifyEmailForm() {
  const tokenRef = React.useRef<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [complete, setComplete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fragment = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    if (/^[A-Za-z0-9_-]{43}$/.test(fragment)) tokenRef.current = fragment;
  }, []);

  async function verify() {
    const token = tokenRef.current;
    tokenRef.current = null;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setError(
        'This verification link is missing or invalid. Request a new link from your account.'
      );
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/email-verification/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'This verification link is invalid or has expired.');
        return;
      }
      setComplete(true);
    } catch {
      tokenRef.current = token;
      setError('Network error. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {complete ? (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          Email ownership verified. Your account access and status have not been changed.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Confirm that you opened this link from the mailbox for your AgencyOS account.
          </p>
          <button
            type="button"
            onClick={verify}
            disabled={pending}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {pending ? 'Verifying…' : 'Verify email address'}
          </button>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
