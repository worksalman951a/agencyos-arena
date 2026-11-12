/**
 * Portal dashboard.
 *
 * Server-rendered from the client's own grants: project list, pending approvals,
 * recent client-visible feedback and unread notification count. Nothing on this
 * page is fetched with a caller-supplied id.
 */

import Link from 'next/link';

import { getPortalDashboard } from '@/lib/services/portal/portal-workspace-service';
import { loadPortalPageData } from '@/lib/portal/page-data';

export const dynamic = 'force-dynamic';

function StateNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      {children}
    </div>
  );
}

export default async function PortalDashboardPage() {
  const result = await loadPortalPageData(() => getPortalDashboard());

  if (!result.ok) {
    return (
      <StateNotice>
        {result.reason === 'inactive'
          ? 'Your portal access is not active. Please contact your agency.'
          : 'We could not load your workspace right now. Please try again.'}
      </StateNotice>
    );
  }

  const dashboard = result.data;

  const cards = [
    { label: 'Projects', value: dashboard.counts.projects, href: '/portal/projects' },
    { label: 'Shared documents', value: dashboard.counts.documents, href: '/portal/documents' },
    {
      label: 'Pending approvals',
      value: dashboard.counts.pendingApprovals,
      href: '/portal/approvals',
    },
    {
      label: 'Unread notifications',
      value: dashboard.counts.unreadNotifications,
      href: '/portal/notifications',
    },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-2xl font-bold">Welcome, {dashboard.clientName}</h2>
        <p className="text-sm text-muted-foreground">
          This is the workspace {dashboard.organizationName} shares with you.
        </p>
      </section>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-lg border bg-background p-4 hover:border-accent"
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold" data-testid={`portal-count-${card.label}`}>
              {card.value}
            </p>
          </Link>
        ))}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Your projects</h3>
          <Link href="/portal/projects" className="text-sm text-accent hover:underline">
            View all
          </Link>
        </div>
        {dashboard.projects.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No projects have been shared with you yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {dashboard.projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between py-2">
                <Link href={`/portal/projects/${project.id}`} className="hover:underline">
                  {project.name}
                </Link>
                <span className="text-xs uppercase text-muted-foreground">{project.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Awaiting your decision</h3>
          <Link href="/portal/approvals" className="text-sm text-accent hover:underline">
            View approvals
          </Link>
        </div>
        {dashboard.pendingApprovals.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing is waiting on you right now.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {dashboard.pendingApprovals.map((approval) => (
              <li key={approval.id} className="flex items-center justify-between py-2">
                <Link href={`/portal/approvals/${approval.id}`} className="hover:underline">
                  {approval.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {approval.dueAt ? `Due ${approval.dueAt.toLocaleDateString()}` : 'No due date'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h3 className="text-lg font-semibold">Recent conversation</h3>
        {dashboard.recentFeedback.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {dashboard.recentFeedback.map((comment) => (
              <li key={comment.id} className="rounded-md bg-muted/40 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {comment.authorType === 'client' ? 'You' : 'Agency team'} · {comment.resourceType}
                </p>
                <p className="mt-1">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
