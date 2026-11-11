/**
 * Public Client Document Viewer (/share/[token]).
 *
 * Unauthenticated read-only surface backed by token-gated, time-bound,
 * access-counted snapshots. Never exposes internal organization IDs or
 * cross-tenant data.
 */

import { verifyDocumentLink } from '@/lib/services/documents/link-service';
import { SharedDocumentPrintButton } from './SharedDocumentActions';

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
        <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 font-bold">
            !
          </div>
          <h1 className="text-xl font-bold text-slate-900">Link Unavailable</h1>
          <p className="text-sm text-slate-600">
            {errorMessage ?? 'This shared link is invalid, revoked, or has expired.'}
          </p>
        </div>
      </main>
    );
  }

  const { documentTitle, documentType, expiresAt, accessCount, maxAccess, snapshot } = sharedView;

  const branding = snapshot?.branding ?? null;
  const accentColor = branding?.brandColor || '#2563eb';
  const displayOrgName = branding?.brandName || 'AgencyOS';
  const entityKind = String(snapshot?.entityType ?? documentType ?? 'document').toUpperCase();
  const displayTitle = snapshot?.title || documentTitle;
  const number = snapshot?.number ?? null;
  const status = snapshot?.status ?? null;
  const currency = snapshot?.currency || 'USD';
  const clientName = snapshot?.clientName ?? null;
  const validUntil = snapshot?.validUntil ?? null;
  const notes = snapshot?.notes ?? null;
  const subtotal =
    snapshot?.subtotal !== undefined && snapshot?.subtotal !== null
      ? Number(snapshot.subtotal)
      : null;
  const tax = snapshot?.tax !== undefined && snapshot?.tax !== null ? Number(snapshot.tax) : null;
  const total =
    snapshot?.total !== undefined && snapshot?.total !== null ? Number(snapshot.total) : null;
  const items = snapshot?.items ?? [];

  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">
            Shared securely by {displayOrgName}
          </span>
          <SharedDocumentPrintButton />
        </div>

        <article className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="h-2 w-full" style={{ backgroundColor: accentColor }} />

          <div className="p-8 space-y-8">
            <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-200 pb-6">
              <div className="flex items-center gap-3">
                {branding?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={branding.logoUrl}
                    alt={`${displayOrgName} logo`}
                    className="h-10 w-auto max-w-[160px] object-contain"
                  />
                ) : (
                  <div
                    className="h-9 w-9 rounded-md flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: accentColor }}
                  >
                    {displayOrgName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="text-lg font-bold text-slate-900">{displayOrgName}</div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider">
                    {entityKind}
                  </div>
                </div>
              </div>

              <div className="sm:text-right space-y-1">
                <h1 className="text-2xl font-bold text-slate-900">{displayTitle}</h1>
                <div className="flex sm:justify-end items-center gap-2 text-sm text-slate-600">
                  {number && <span className="font-mono">#{number}</span>}
                  {status && (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium capitalize text-slate-800">
                      {status}
                    </span>
                  )}
                </div>
              </div>
            </header>

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
              <div>
                {clientName && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Prepared For
                    </div>
                    <div className="font-semibold text-slate-900 text-base">{clientName}</div>
                  </div>
                )}
              </div>

              <div className="sm:text-right space-y-1 text-slate-600">
                {validUntil && (
                  <div>
                    <span className="text-slate-400">Valid Until: </span>
                    <span className="font-medium text-slate-900">
                      {new Date(validUntil).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {snapshot?.signedAt && (
                  <div>
                    <span className="text-slate-400">Signed At: </span>
                    <span className="font-medium text-emerald-700">
                      {new Date(snapshot.signedAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {snapshot?.signatureReference && (
                  <div>
                    <span className="text-slate-400">Signature Ref: </span>
                    <span className="font-mono text-xs text-slate-900">
                      {snapshot.signatureReference}
                    </span>
                  </div>
                )}
              </div>
            </section>

            {items.length > 0 && (
              <section className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-200 text-xs uppercase text-slate-500">
                      <th className="py-2.5 font-semibold">Description</th>
                      <th className="py-2.5 font-semibold text-right">Qty</th>
                      <th className="py-2.5 font-semibold text-right">Unit Price</th>
                      <th className="py-2.5 font-semibold text-right">Tax %</th>
                      <th className="py-2.5 font-semibold text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="py-3 text-slate-900">{item.description || '—'}</td>
                        <td className="py-3 text-right text-slate-700">
                          {Number(item.quantity ?? 0).toLocaleString()}
                        </td>
                        <td className="py-3 text-right text-slate-700">
                          {currency}{' '}
                          {Number(item.unitPrice ?? 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="py-3 text-right text-slate-700">
                          {Number(item.taxRate ?? 0).toFixed(2)}%
                        </td>
                        <td className="py-3 text-right font-medium text-slate-900">
                          {currency}{' '}
                          {Number(item.amount ?? 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {total !== null && (
              <section className="flex justify-end">
                <div className="w-full max-w-xs space-y-2 text-sm">
                  {subtotal !== null && (
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal</span>
                      <span>
                        {currency}{' '}
                        {subtotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  )}
                  {tax !== null && (
                    <div className="flex justify-between text-slate-600">
                      <span>Tax</span>
                      <span>
                        {currency}{' '}
                        {tax.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  )}
                  <div
                    className="flex justify-between pt-2 border-t-2 font-bold text-base text-slate-900"
                    style={{ borderColor: accentColor }}
                  >
                    <span>Total</span>
                    <span>
                      {currency}{' '}
                      {total.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              </section>
            )}

            {notes && (
              <section className="border-t border-slate-200 pt-6">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Notes &amp; Terms
                </h2>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{notes}</p>
              </section>
            )}
          </div>

          <footer className="bg-slate-50 border-t border-slate-200 px-8 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
            <span>Link expires {new Date(expiresAt).toLocaleString()}</span>
            <span>
              Views: {accessCount}
              {maxAccess !== null ? ` / ${maxAccess}` : ''}
            </span>
          </footer>
        </article>
      </div>
    </main>
  );
}
