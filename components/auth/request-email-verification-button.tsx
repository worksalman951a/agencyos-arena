'use client';

import * as React from 'react';

/** Safe, enumeration-neutral request action shared by internal and portal UI. */
export function RequestEmailVerificationButton({
  email,
  className = '',
}: {
  email: string;
  className?: string;
}) {
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function requestVerification() {
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/email-verification/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? 'Could not request verification. Please try again later.');
        return;
      }
      setMessage(body.message ?? 'If the account can be verified, an email will be sent.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={requestVerification}
        disabled={pending}
        className="rounded-md border border-current px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50"
      >
        {pending ? 'Requesting…' : 'Send verification email'}
      </button>
      {message ? (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
