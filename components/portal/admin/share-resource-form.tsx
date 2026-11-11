'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { PORTAL_RESOURCE_LABELS, PORTAL_RESOURCE_TYPES } from '@/lib/portal/resource-registry';

export interface ShareableResourceOption {
  type: string;
  id: string;
  title: string;
}

/**
 * Share one internal resource with a client.
 *
 * The option list only contains records from this organization; the server
 * re-checks existence and organization scope, so a tampered value cannot share a
 * foreign record.
 */
export function ShareResourceForm({
  accessId,
  resources,
}: {
  accessId: string;
  resources: ShareableResourceOption[];
}) {
  const router = useRouter();
  const [type, setType] = React.useState<string>(PORTAL_RESOURCE_TYPES[0]);
  const [resourceId, setResourceId] = React.useState('');
  const [canApprove, setCanApprove] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const options = resources.filter((resource) => resource.type === type);
  const selected = resourceId || options[0]?.id || '';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setError('There is nothing of this type to share yet.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/client-access/${accessId}/grants`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          resourceType: type,
          resourceId: selected,
          canComment: true,
          canApprove,
        }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? 'Could not share this resource.');
        return;
      }

      setResourceId('');
      router.refresh();
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`type-${accessId}`}>
            Type
          </label>
          <select
            id={`type-${accessId}`}
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setResourceId('');
            }}
            className="rounded-md border bg-background px-2 py-1 text-xs"
          >
            {PORTAL_RESOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {PORTAL_RESOURCE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[12rem] flex-1 space-y-1">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor={`resource-${accessId}`}
          >
            Resource
          </label>
          <select
            id={`resource-${accessId}`}
            value={selected}
            onChange={(event) => setResourceId(event.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          >
            {options.length === 0 ? <option value="">Nothing available</option> : null}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={canApprove}
            onChange={(event) => setCanApprove(event.target.checked)}
          />
          Allow approvals
        </label>

        <button
          type="submit"
          disabled={pending || options.length === 0}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
        >
          {pending ? 'Sharing…' : 'Share'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
