'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Capability toggles plus suspend / revoke for one client access.
 *
 * Toggles write only the capability flags. Suspension and revocation invalidate
 * the client's live sessions server-side, so the effect is immediate.
 */
export function ClientAccessActions({
  access,
}: {
  access: {
    id: string;
    status: string;
    role: string;
    canViewInvoices: boolean;
    canDownloadFiles: boolean;
    canComment: boolean;
    canApprove: boolean;
  };
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [flags, setFlags] = React.useState({
    canViewInvoices: access.canViewInvoices,
    canDownloadFiles: access.canDownloadFiles,
    canComment: access.canComment,
    canApprove: access.canApprove,
  });

  const revoked = access.status === 'revoked';

  async function patch(body: Record<string, unknown>, marker: string) {
    setPending(marker);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/client-access/${access.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? 'Could not update this client.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(null);
    }
  }

  async function revoke() {
    setPending('revoke');
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/client-access/${access.id}/revoke`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? 'Could not revoke this client.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(null);
    }
  }

  if (revoked) {
    return (
      <span className="text-xs text-muted-foreground">
        Revoked — invite the contact again to restore access.
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-xs">
        {(
          [
            ['canViewInvoices', 'Invoices'],
            ['canDownloadFiles', 'Downloads'],
            ['canComment', 'Comments'],
            ['canApprove', 'Approvals'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={flags[key]}
              disabled={pending !== null}
              onChange={(event) => {
                const next = { ...flags, [key]: event.target.checked };
                setFlags(next);
                void patch({ [key]: next[key] }, key);
              }}
            />
            {label}
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() =>
            patch({ status: access.status === 'suspended' ? 'active' : 'suspended' }, 'status')
          }
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          data-testid={`toggle-suspend-${access.id}`}
        >
          {access.status === 'suspended' ? 'Reactivate' : 'Suspend'}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={revoke}
          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          data-testid={`revoke-access-${access.id}`}
        >
          Revoke access
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
