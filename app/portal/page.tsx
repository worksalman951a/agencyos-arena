import Link from 'next/link';
import { Download } from 'lucide-react';
import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { getClientPortalOverview } from '@/lib/services/portal/portal-data-service';

export default async function ClientPortalOverviewPage() {
  const data = await getClientPortalOverview();
  const { context } = data;

  return (
    <div className="space-y-6">
      {/* ── Welcome Banner ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome back, {context.contactName}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Here is your client workspace summary for{' '}
            {context.accountName || context.organizationName}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/portal/invoices">View Invoices</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Link href="/portal/documents">Review Documents</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Metrics ─────────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Open Invoices',
            value: data.openInvoicesCount.toString(),
            note: `${data.openInvoicesTotal} outstanding`,
            tone: data.openInvoicesCount > 0 ? 'warn' : 'ok',
          },
          {
            label: 'Active Projects',
            value: data.activeProjectsCount.toString(),
            note: 'live delivery engagements',
            tone: 'ok',
          },
          {
            label: 'Pending Documents',
            value: data.pendingDocumentsCount.toString(),
            note: 'awaiting review or acceptance',
            tone: data.pendingDocumentsCount > 0 ? 'warn' : undefined,
          },
          {
            label: 'Total Billing Records',
            value: data.invoicesCount.toString(),
            note: 'lifetime statements',
          },
        ]}
      />

      {/* ── 2-Column Bento Grid ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Recent Invoices Panel */}
        <Panel
          title="Recent Invoices & Statements"
          action={
            <Button asChild variant="outline" size="sm" className="h-7 text-xs">
              <Link href="/portal/invoices">View All ({data.invoicesCount})</Link>
            </Button>
          }
        >
          {data.recentInvoices.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No invoices issued yet.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {data.recentInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="py-3 px-4 flex items-center justify-between text-xs hover:bg-muted/20"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold text-foreground">{inv.number}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{inv.title}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-mono font-semibold text-foreground">
                        {inv.currency} {inv.total}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Due:{' '}
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : 'Upon receipt'}
                      </div>
                    </div>
                    <StatusPill
                      tone={
                        inv.status === 'paid' ? 'ok' : inv.status === 'overdue' ? 'danger' : 'warn'
                      }
                    >
                      {inv.status.toUpperCase()}
                    </StatusPill>
                    <Button asChild variant="outline" size="sm" className="h-7 px-2">
                      <a
                        href={`/api/v1/portal/pdf?type=invoice&id=${inv.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download size={12} />
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Proposals & Statements Panel */}
        <Panel
          title="Documents for Review"
          action={
            <Button asChild variant="outline" size="sm" className="h-7 text-xs">
              <Link href="/portal/documents">View All</Link>
            </Button>
          }
        >
          {data.recentDocuments.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No pending documents.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {data.recentDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="py-3 px-4 flex items-center justify-between text-xs hover:bg-muted/20"
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <span className="uppercase text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        {doc.type}
                      </span>
                      <span>{doc.number}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {doc.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill
                      tone={
                        doc.status === 'accepted'
                          ? 'ok'
                          : doc.status === 'sent'
                            ? 'warn'
                            : undefined
                      }
                    >
                      {doc.status.toUpperCase()}
                    </StatusPill>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Active Projects Panel */}
        <div className="lg:col-span-2">
          <Panel
            title="Projects & Delivery Progress"
            action={
              <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                <Link href="/portal/projects">Open Projects Registry</Link>
              </Button>
            }
          >
            {data.recentProjects.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No active projects assigned to your account.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                {data.recentProjects.map((p) => (
                  <div key={p.id} className="p-4 rounded-lg border bg-card space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground truncate">{p.name}</span>
                      <StatusPill tone="ok">{p.status.toUpperCase()}</StatusPill>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Timeline: {p.startDate ? new Date(p.startDate).toLocaleDateString() : 'TBD'} —{' '}
                      {p.endDate ? new Date(p.endDate).toLocaleDateString() : 'Ongoing'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
