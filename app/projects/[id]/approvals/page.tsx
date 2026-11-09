/**
 * AgencyOS Project Approvals page.
 * Lists approvals for a project and provides create/approve actions.
 */

import Link from 'next/link';
import { listProjectApprovals } from '@/lib/services/projects/project-approval-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { NewApprovalForm } from './NewApprovalForm';

export default async function ProjectApprovalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await loadPageData(() => listProjectApprovals(id));

  if (!result.ok) {
    return (
      <PageStateNotice
        reason={result.reason}
        backHref={`/projects/${id}`}
        backLabel="Back to project"
      />
    );
  }

  const approvals = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Client Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Manage client sign-off and approval decisions for this project.
          </p>
        </div>
        <Link
          href={`/projects/${id}`}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to Project
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-2xl">
        <h2 className="text-lg font-semibold mb-4">Record Approval</h2>
        <NewApprovalForm projectId={id} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Contact</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Feedback</th>
              <th className="pb-3 font-medium text-right">Approved At</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(
              approvals as Array<{
                id: string;
                status: string;
                feedback: string | null;
                contact: {
                  firstName: string | null;
                  lastName: string;
                  email: string | null;
                } | null;
                creator: { name: string | null } | null;
                approvedAt: Date | null;
                createdAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  No approvals found. Record an approval decision to get started.
                </td>
              </tr>
            ) : (
              (
                approvals as Array<{
                  id: string;
                  status: string;
                  feedback: string | null;
                  contact: {
                    firstName: string | null;
                    lastName: string;
                    email: string | null;
                  } | null;
                  creator: { name: string | null } | null;
                  approvedAt: Date | null;
                  createdAt: Date;
                }>
              ).map((approval) => (
                <tr key={approval.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    {approval.contact
                      ? `${approval.contact.firstName ?? ''} ${approval.contact.lastName}`.trim()
                      : approval.creator?.name || 'System'}
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        approval.status === 'approved'
                          ? 'bg-green-100 text-green-800'
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
                    {approval.approvedAt ? new Date(approval.approvedAt).toLocaleDateString() : '—'}
                  </td>
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
