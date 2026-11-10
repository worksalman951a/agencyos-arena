/**
 * AgencyOS Organization Approvals index page.
 * Lists project approvals across the organization.
 */

import Link from 'next/link';
import { listProjectApprovals } from '@/lib/services/projects/project-approval-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export default async function AllProjectApprovalsPage() {
  const result = await loadPageData(() => listProjectApprovals());

  if (!result.ok) {
    return (
      <PageStateNotice reason={result.reason} backHref="/projects" backLabel="Back to projects" />
    );
  }

  const approvals = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Client and internal approval records across all projects.
          </p>
        </div>
        <Link
          href="/projects"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to Projects
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Project</th>
              <th className="pb-3 font-medium">Contact / Reviewer</th>
              <th className="pb-3 font-medium">Type</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Feedback</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {approvals.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No approvals recorded yet. Open a project to record an approval.
                </td>
              </tr>
            ) : (
              approvals.map((approval) => (
                <tr key={approval.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    <Link
                      href={`/projects/${approval.projectId}/approvals`}
                      className="text-accent hover:underline"
                    >
                      {approval.project?.name ?? approval.projectId}
                    </Link>
                  </td>
                  <td className="py-4 text-sm">
                    {approval.contact
                      ? `${approval.contact.firstName ?? ''} ${approval.contact.lastName}`.trim()
                      : approval.creator?.name || approval.creator?.email || 'Internal'}
                  </td>
                  <td className="py-4 text-xs text-muted-foreground">
                    {approval.contact ? 'Client' : 'Internal'}
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        approval.status === 'approved'
                          ? 'bg-green-100 text-green-800'
                          : approval.status === 'rejected'
                            ? 'bg-red-100 text-red-800'
                            : approval.status === 'changes_requested'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {approval.status}
                    </span>
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">{approval.feedback ?? '—'}</td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(approval.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/projects/approvals/${approval.id}`}
                      className="text-sm text-accent hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
