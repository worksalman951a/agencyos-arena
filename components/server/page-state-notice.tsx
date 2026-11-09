import Link from 'next/link';

/**
 * Inline notice rendered by a Server Component when its data could not be
 * loaded. Server-safe (no client hooks), so pages keep working without an
 * error boundary while still telling the user what happened instead of showing
 * a misleading empty table.
 */
export function PageStateNotice({
  reason,
  backHref = '/dashboard',
  backLabel = 'Back to dashboard',
}: {
  reason: 'forbidden' | 'not-found' | 'error';
  backHref?: string;
  backLabel?: string;
}) {
  const forbidden = reason === 'forbidden';
  const missing = reason === 'not-found';

  const heading = forbidden
    ? 'You do not have access to this section'
    : missing
      ? 'This record was not found'
      : 'Unable to load this page';

  const body = forbidden
    ? 'Your role does not include the permission required here. An administrator can grant access.'
    : missing
      ? 'It may have been deleted, or it belongs to another organization.'
      : 'Something went wrong while loading the data. Please try again in a moment.';

  return (
    <div className="p-6">
      <div
        role="alert"
        className={
          forbidden
            ? 'max-w-xl rounded-lg border border-amber-300/60 bg-amber-50 p-6 dark:bg-amber-950/30'
            : 'max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 p-6'
        }
      >
        <h1 className="text-lg font-semibold">{heading}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <Link href={backHref} className="mt-4 inline-block text-sm text-accent hover:underline">
          {backLabel}
        </Link>
      </div>
    </div>
  );
}
