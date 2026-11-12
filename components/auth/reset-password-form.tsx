'use client';

import * as React from 'react';
import Link from 'next/link';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/auth/password-reset-policy';

/**
 * Complete a password reset.
 *
 * The token arrived in the page path; it is sent in the POST body, never put in
 * a query string or a URL this component navigates to. After success the only
 * destination offered is the fixed sign-in page - there is no callback URL, so
 * a crafted link cannot turn the reset into an open redirect.
 *
 * The client-side checks mirror the server policy for a fast answer; the server
 * validates again and is the only authority. A rejected password does not spend
 * the token.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const response = await fetch('/api/v1/auth/password-reset/confirm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(
          body.error ??
            'The password could not be changed. The link may have expired — request a new one.'
        );
        return;
      }

      setPassword('');
      setConfirmation('');
      setDone(true);
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <p
          role="status"
          data-testid="reset-password-complete"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          Your password has been changed. For your security, every existing session has been signed
          out.
        </p>
        <Link
          href="/login"
          className="block w-full rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-foreground hover:bg-accent/90"
        >
          Sign in with your new password
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <div className="space-y-1">
        <label htmlFor="new-password" className="text-xs font-medium text-muted-foreground">
          New password
        </label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          required
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          At least {PASSWORD_MIN_LENGTH} characters, at most {PASSWORD_MAX_LENGTH}.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="confirm-password" className="text-xs font-medium text-muted-foreground">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}{' '}
          <Link href="/forgot-password" className="underline">
            Request a new link
          </Link>
          .
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Changing password…' : 'Change password'}
      </button>
    </form>
  );
}
