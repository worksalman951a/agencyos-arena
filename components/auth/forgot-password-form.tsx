'use client';

import * as React from 'react';

/**
 * Request a password-reset link.
 *
 * The server deliberately answers the same way for a known and an unknown
 * address; this form must not add a distinction of its own. It therefore shows
 * one confirmation for every successful response and only surfaces genuine
 * request problems (invalid address, throttling, network/database failure).
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/v1/auth/password-reset/request', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        setError(body.error ?? 'The request could not be sent. Please try again.');
        return;
      }

      setMessage(
        body.message ??
          'If an account exists for that e-mail address, a password reset link has been sent.'
      );
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <div className="space-y-1">
        <label htmlFor="email" className="text-xs font-medium text-muted-foreground">
          E-mail address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {message ? (
        <p
          role="status"
          data-testid="reset-request-confirmation"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          {message}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}
