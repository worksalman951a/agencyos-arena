import { Panel, StatusPill } from '@/components/ui/premium/primitives';
import { listClientPortalDocuments } from '@/lib/services/portal/portal-data-service';

export default async function ClientPortalDocumentsPage() {
  const documents = await listClientPortalDocuments();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Proposals & Quotations
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review commercial proposals, scopes of work, and project quotations.
          </p>
        </div>
      </div>

      <Panel title="Commercial Deliverables">
        {documents.length === 0 ? (
          <div className="text-center py-12 text-xs text-muted-foreground">
            No proposals or quotations currently assigned to your account.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="py-2.5 px-4">Document Type</th>
                  <th className="py-2.5 px-4">Number</th>
                  <th className="py-2.5 px-4">Title</th>
                  <th className="py-2.5 px-4">Valid Until</th>
                  <th className="py-2.5 px-4 text-right">Value</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 font-medium uppercase text-[10px]">
                      <span className="bg-muted px-2 py-0.5 rounded text-muted-foreground">
                        {doc.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-foreground">
                      {doc.number}
                    </td>
                    <td className="py-3 px-4 text-foreground font-medium">{doc.title}</td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {doc.validUntil ? new Date(doc.validUntil).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                      {doc.currency} {doc.total}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <StatusPill
                        tone={
                          doc.status === 'accepted'
                            ? 'ok'
                            : doc.status === 'rejected'
                              ? 'danger'
                              : 'warn'
                        }
                      >
                        {doc.status.toUpperCase()}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
