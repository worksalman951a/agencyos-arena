/**
 * Portal documents: proposals, quotations, estimates, contracts and files shared
 * with this client. Contract signatures are displayed read-only — the portal never
 * creates, alters or re-signs them.
 */

import { listPortalDocuments } from '@/lib/services/portal/portal-workspace-service';
import { loadPortalPageData } from '@/lib/portal/page-data';

export const dynamic = 'force-dynamic';

function formatMoney(amount: string | null, currency: string | null): string {
  if (amount === null) return '';
  const numeric = Number(amount);
  const formatted = Number.isFinite(numeric) ? numeric.toFixed(2) : amount;
  return `${currency ?? ''} ${formatted}`.trim();
}

export default async function PortalDocumentsPage() {
  const result = await loadPortalPageData(() => listPortalDocuments());

  if (!result.ok) {
    return (
      <div role="alert" className="rounded-md border p-4 text-sm">
        Documents are not available for this account right now.
      </div>
    );
  }

  const documents = result.data;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Shared documents</h2>
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been shared with you yet.</p>
      ) : (
        <ul className="space-y-3">
          {documents.map((document) => (
            <li
              key={`${document.type}:${document.id}`}
              className="rounded-lg border bg-background p-4"
              data-testid={`shared-${document.type}-${document.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {document.type}
                    {document.subtitle ? ` · ${document.subtitle}` : ''}
                  </p>
                  <h3 className="text-lg font-semibold">{document.title}</h3>
                </div>
                <div className="text-right text-sm">
                  {document.status ? (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs uppercase text-muted-foreground">
                      {document.status}
                    </span>
                  ) : null}
                </div>
              </div>

              {document.total ? (
                <p className="mt-2 text-sm font-medium">
                  {formatMoney(document.total, document.currency)}
                </p>
              ) : null}

              {document.validUntil ? (
                <p className="text-xs text-muted-foreground">
                  Valid until {document.validUntil.toLocaleDateString()}
                </p>
              ) : null}

              {document.signedAt ? (
                <p className="text-xs text-muted-foreground">
                  Signed {document.signedAt.toLocaleDateString()}
                  {document.signatureReference ? ` · reference ${document.signatureReference}` : ''}
                </p>
              ) : null}

              {document.downloadable ? (
                <a
                  className="mt-2 inline-block text-sm text-accent hover:underline"
                  href={`/api/v1/portal/download/document/${document.id}`}
                >
                  Download document
                </a>
              ) : null}

              {document.items.length > 0 ? (
                <table className="mt-3 w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="pb-1">Description</th>
                      <th className="pb-1 text-right">Qty</th>
                      <th className="pb-1 text-right">Unit price</th>
                      <th className="pb-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {document.items.map((item, index) => (
                      <tr key={`${document.id}-item-${index}`} className="border-b last:border-0">
                        <td className="py-1">{item.description}</td>
                        <td className="py-1 text-right">{item.quantity}</td>
                        <td className="py-1 text-right">{item.unitPrice}</td>
                        <td className="py-1 text-right">{item.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
