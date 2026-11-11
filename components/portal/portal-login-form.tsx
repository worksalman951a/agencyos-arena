'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { signInEmail, signUpEmail } from '@/lib/auth-client';

/**
 * Client login / activation form.
 *
 * Sign-in and sign-up both go through Better Auth's own endpoints. Signing up
 * creates a Better Auth user with no organization and no roles; portal access
 * exists only after an invitation is accepted, so self-registration cannot
 * produce a client identity on its own.
 */
export function PortalLoginForm({ initialEmail = '' }: { initialEmail?: string }) {
  const router = useRouter();
  const [email, setEmail] = React.useState(initialEmail);
  const [password, setPassword] = React.useState('');
  const [mode, setMode] = React.useState<'signin' | 'signup'>('signin');
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      if (mode === 'signup') {
        await signUpEmail({ email, password, name: name || undefined });
        // Better Auth does not auto sign in for this project (autoSignIn: false).
        await signInEmail({ email, password });
      } else {
        await signInEmail({ email, password });
      }

      router.push('/portal');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mode === 'signup' ? (
        <div className="space-y-1">
          <label htmlFor="name" className="text-xs font-medium text-muted-foreground">
            Your name
          </label>
          <input
            id="name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="email" className="text-xs font-medium text-muted-foreground">
          E-mail
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

      <div className="space-y-1">
        <label htmlFor="password" className="text-xs font-medium text-muted-foreground">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
        className="w-full text-xs text-muted-foreground hover:underline"
      >
        {mode === 'signup' ? 'Already activated? Sign in' : 'First time here? Create your password'}
      </button>
    </form>
  );
}
