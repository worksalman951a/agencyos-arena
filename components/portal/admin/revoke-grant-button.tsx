'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/** Withdraw one share from a client. */
export function RevokeGrantButton({ accessId, grantId }: { accessId: string; grantId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function revoke() {
    setPending(true);
    try {
      await fetch(`/api/v1/admin/client-access/${accessId}/grants/${grantId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={revoke}
      disabled={pending}
      className="text-xs text-red-700 hover:underline disabled:opacity-50"
    >
      {pending ? 'Removing…' : 'Unshare'}
    </button>
  );
}
