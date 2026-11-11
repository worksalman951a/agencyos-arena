'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/** Marks every notification of the signed-in client read, then refreshes. */
export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await fetch('/api/v1/portal/notifications', {
        method: 'POST',
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
      onClick={handleClick}
      disabled={pending}
      className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
    >
      {pending ? 'Marking…' : 'Mark all read'}
    </button>
  );
}
