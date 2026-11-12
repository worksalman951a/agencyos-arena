import { Panel, StatusPill } from '@/components/ui/premium/primitives';
import { listClientPortalProjects } from '@/lib/services/portal/portal-data-service';

export default async function ClientPortalProjectsPage() {
  const projects = await listClientPortalProjects();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Projects & Delivery</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track engagement milestones and delivery timelines for your account.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {projects.length === 0 ? (
          <Panel pad>
            <div className="text-center py-12 text-xs text-muted-foreground">
              No active delivery projects assigned to your account.
            </div>
          </Panel>
        ) : (
          (
            projects as Array<{
              id: string;
              name: string;
              description: string | null;
              status: string;
              startDate: Date | null;
              endDate: Date | null;
              milestones: Array<{ id: string; name: string; status: string; dueDate: Date | null }>;
            }>
          ).map((p) => (
            <Panel key={p.id} title={p.name}>
              <div className="p-4 space-y-4 text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Status</span>
                    <StatusPill tone="ok">{p.status.toUpperCase()}</StatusPill>
                  </div>
                  <div className="text-right sm:text-right">
                    <span className="text-muted-foreground block text-[11px]">Timeline</span>
                    <span className="font-medium text-foreground">
                      {p.startDate ? new Date(p.startDate).toLocaleDateString() : 'TBD'} —{' '}
                      {p.endDate ? new Date(p.endDate).toLocaleDateString() : 'Ongoing'}
                    </span>
                  </div>
                </div>

                {p.description && (
                  <p className="text-muted-foreground leading-relaxed">{p.description}</p>
                )}

                {/* Milestones */}
                <div>
                  <h4 className="font-semibold text-foreground text-xs mb-2">
                    Delivery Milestones
                  </h4>
                  {p.milestones.length === 0 ? (
                    <div className="text-muted-foreground text-[11px]">
                      No milestones scheduled.
                    </div>
                  ) : (
                    <div className="divide-y divide-border/60 border rounded-md">
                      {p.milestones.map((m) => (
                        <div key={m.id} className="p-2.5 flex items-center justify-between">
                          <span className="font-medium text-foreground">{m.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">
                              {m.dueDate ? new Date(m.dueDate).toLocaleDateString() : 'No date'}
                            </span>
                            <StatusPill tone={m.status === 'completed' ? 'ok' : undefined}>
                              {m.status.toUpperCase()}
                            </StatusPill>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          ))
        )}
      </div>
    </div>
  );
}
