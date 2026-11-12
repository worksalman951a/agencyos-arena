'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Request a client approval on a resource that is already shared with them.
 * The server refuses an unshared resource or a client without the approve flag.
 */
export function RequestApprovalForm({
  clients,
  grants,
}: {
  clients: Array<{ id: string; name: string }>;
  grants: Array<{
    clientAccessId: string;
    resourceType: string;
    resourceId: string;
    label: string;
  }>;
}) {
  const router = useRouter();
  const [clientAccessId, setClientAccessId] = React.useState(clients[0]?.id ?? '');
  const [grantKey, setGrantKey] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const options = grants.filter(
    (grant) => grant.clientAccessId === clientAccessId && grant.label !== ''
  );
  const selectedKey =
    grantKey || (options[0] ? `${options[0].resourceType}:${options[0].resourceId}` : '');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const grant = options.find(
      (option) => `${option.resourceType}:${option.resourceId}` === selectedKey
    );
    if (!grant || !title.trim()) {
      setError('Choose a shared resource and give the request a title.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/client-approvals', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          clientAccessId,
          resourceType: grant.resourceType,
          resourceId: grant.resourceId,
          title: title.trim(),
        }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? 'Could not request the approval.');
        return;
      }

      setTitle('');
      router.refresh();
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4 md:items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="approval-client">
            Client
          </label>
          <select
            id="approval-client"
            value={clientAccessId}
            onChange={(event) => {
              setClientAccessId(event.target.value);
              setGrantKey('');
            }}
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="approval-resource">
            Shared resource
          </label>
          <select
            id="approval-resource"
            value={selectedKey}
            onChange={(event) => setGrantKey(event.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          >
            {options.length === 0 ? (
              <option value="">Nothing shared with this client yet</option>
            ) : null}
            {options.map((option) => (
              <option
                key={`${option.resourceType}:${option.resourceId}`}
                value={`${option.resourceType}:${option.resourceId}`}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="approval-title">
            Title
          </label>
          <input
            id="approval-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border px-2 py-1 text-xs"
            placeholder="Approve homepage design"
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || options.length === 0}
        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Requesting…' : 'Request approval'}
      </button>
    </form>
  );
}
