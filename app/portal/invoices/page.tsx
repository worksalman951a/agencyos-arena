import { Download } from 'lucide-react';
import { Panel, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { listClientPortalInvoices } from '@/lib/services/portal/portal-data-service';

export default async function ClientPortalInvoicesPage() {
  const invoices = await listClientPortalInvoices();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Invoices & Billing</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            View authorized billing statements and download PDF receipts.
          </p>
        </div>
      </div>

      <Panel title="Issued Invoices">
        {invoices.length === 0 ? (
          <div className="text-center py-12 text-xs text-muted-foreground">
            No invoices have been issued to your account.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="py-2.5 px-4">Invoice #</th>
                  <th className="py-2.5 px-4">Description</th>
                  <th className="py-2.5 px-4">Due Date</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                  <th className="py-2.5 px-4 text-right">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {(
                  invoices as Array<{
                    id: string;
                    number: string;
                    title: string;
                    dueDate: Date | null;
                    currency: string;
                    total: string;
                    status: string;
                  }>
                ).map((inv) => (
                  <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-foreground">
                      {inv.number}
                    </td>
                    <td className="py-3 px-4 text-foreground font-medium">{inv.title}</td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : 'Upon receipt'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                      {inv.currency} {inv.total}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <StatusPill
                        tone={
                          inv.status === 'paid'
                            ? 'ok'
                            : inv.status === 'overdue'
                              ? 'danger'
                              : 'warn'
                        }
                      >
                        {inv.status.toUpperCase()}
                      </StatusPill>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                        <a
                          href={`/api/v1/portal/pdf?type=invoice&id=${inv.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download size={12} className="mr-1" /> PDF
                        </a>
                      </Button>
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
