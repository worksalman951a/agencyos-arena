/**
 * Portal 404.
 *
 * A client asking for a record that was never shared with them must not be able to
 * tell it apart from a record that does not exist, so the portal answers HTTP 404
 * with the same friendly copy in both cases (the team-side app has its own 404).
 */

import Link from 'next/link';

export default function PortalNotFound() {
  return (
    <div role="alert" className="rounded-md border bg-background p-6 text-sm">
      <h2 className="text-lg font-semibold">This item is not available to you</h2>
      <p className="mt-2 text-muted-foreground">
        It may not have been shared with your account, or it may have been withdrawn. If you were
        expecting to see it, ask your agency contact to check the sharing settings.
      </p>
      <Link href="/portal" className="mt-4 inline-block text-accent hover:underline">
        Back to your portal
      </Link>
    </div>
  );
}
