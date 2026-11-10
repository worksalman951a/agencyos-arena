'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/**
 * Invitation form.
 *
 * The API returns the raw token once. It is shown here (and nowhere else) so an
 * administrator can hand the link over; only the hash is persisted.
 */
export function NewInvitationForm({ roles }: { roles: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    setInviteLink(null);

    try {
      const res = await fetch('/api/v1/admin/invitations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email: String(formData.get('email') ?? ''),
          roleId: String(formData.get('roleId') ?? ''),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        acceptPath?: string;
      };

      if (!res.ok) {
        toast.error(body.error ?? 'Could not create the invitation');
        return;
      }

      const path = body.acceptPath ?? '';
      setInviteLink(`${window.location.origin}${path}`);
      toast.success('Invitation created — copy the link below');
      form.reset();
      router.refresh();
    } catch {
      toast.error('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="space-y-1 md:col-span-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="teammate@agency.test"
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="roleId">
            Role
          </label>
          <select
            id="roleId"
            name="roleId"
            required
            defaultValue={roles[0]?.id ?? ''}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending || roles.length === 0}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {pending ? 'Inviting…' : 'Create invitation'}
        </button>
      </form>

      {inviteLink ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
          <p className="font-medium">Acceptance link (shown once)</p>
          <code data-testid="invitation-link" className="block break-all text-xs">
            {inviteLink}
          </code>
        </div>
      ) : null}
    </div>
  );
}
