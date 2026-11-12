/**
 * Public Client Document Viewer (/share/[token]).
 *
 * Unauthenticated read-only surface backed by token-gated, time-bound,
 * access-counted snapshots. Never exposes internal organization IDs or
 * cross-tenant data.
 */

import { verifyDocumentLink } from '@/lib/services/documents/link-service';
import { BentoSharedDocumentView } from '@/components/documents/bento-shared-document-view';

export default async function SharedDocumentPublicPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let sharedView: Awaited<ReturnType<typeof verifyDocumentLink>> | null = null;
  let errorMessage: string | null = null;

  try {
    sharedView = await verifyDocumentLink(token);
  } catch (err) {
    errorMessage =
      err instanceof Error ? err.message : 'This shared document link is invalid or has expired.';
  }

  if (!sharedView) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 font-bold text-lg">
            !
          </div>
          <h1 className="text-xl font-bold text-slate-900">Link Unavailable</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            {errorMessage ?? 'This shared link is invalid, revoked, or has expired.'}
          </p>
          <div className="text-[11px] text-slate-400 font-mono bg-slate-50 py-1.5 px-3 rounded border border-slate-200">
            /share/{token.slice(0, 10)}…
          </div>
          <p className="text-[11px] text-slate-400">
            Nothing about the document is shown here by design &bull; A dead link must not leak its
            contents.
          </p>
        </div>
      </main>
    );
  }

  const { documentTitle, documentType, expiresAt, accessCount, maxAccess, snapshot } = sharedView;

  return (
    <BentoSharedDocumentView
      documentTitle={documentTitle}
      documentType={documentType}
      expiresAt={expiresAt}
      accessCount={accessCount}
      maxAccess={maxAccess}
      snapshot={snapshot as Parameters<typeof BentoSharedDocumentView>[0]['snapshot']}
      token={token}
    />
  );
}
