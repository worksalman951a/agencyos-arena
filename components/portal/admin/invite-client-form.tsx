'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { CLIENT_ROLE_PRESETS } from '@/lib/portal/capabilities';

/**
 * Invite a CRM contact into the client portal.
 *
 * The raw acceptance link is displayed exactly once: only its hash is stored, so
 * it cannot be recovered later. Capability defaults come from the selected role
 * preset, but the server validates and stores the flags it receives.
 */
export function InviteClientForm({
  contacts,
}: {
  contacts: Array<{ id: string; name: string; email: string | null }>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [role, setRole] = React.useState('client_reviewer');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    setError(null);
    setInviteLink(null);

    try {
      const res = await fetch('/api/v1/admin/client-invitations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          contactId: String(formData.get('contactId') ?? ''),
          email: String(formData.get('email') ?? ''),
          role,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string; acceptPath?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not create the invitation.');
        return;
      }

      const path = body.acceptPath ?? '';
      setInviteLink(`${window.location.origin}${path}`);
      form.reset();
      router.refresh();
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end">
        <div className="space-y-1 md:col-span-2">
          <label htmlFor="contactId" className="text-xs font-medium text-muted-foreground">
            CRM contact
          </label>
          <select
            id="contactId"
            name="contactId"
            required
            defaultValue={contacts[0]?.id ?? ''}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
                {contact.email ? ` — ${contact.email}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-xs font-medium text-muted-foreground">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="client@example.test"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="role" className="text-xs font-medium text-muted-foreground">
            Access preset
          </label>
          <select
            id="role"
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {Object.entries(CLIENT_ROLE_PRESETS).map(([value, preset]) => (
              <option key={value} value={value}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-4">
          <button
            type="submit"
            disabled={pending || contacts.length === 0}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create portal invitation'}
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {inviteLink ? (
        <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Acceptance link (shown once)</p>
          <code data-testid="client-invitation-link" className="block break-all text-xs">
            {inviteLink}
          </code>
        </div>
      ) : null}
    </div>
  );
}
