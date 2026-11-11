/**
 * Client approvals (internal view): request an approval, and see every request
 * with its decision, identity and history.
 */

import Link from 'next/link';

import { RequestApprovalForm } from '@/components/portal/admin/request-approval-form';
import { listClientApprovalsForOrganization } from '@/lib/services/portal/client-approval-service';
import { listClientAccesses, listClientGrants } from '@/lib/services/portal/client-access-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export const dynamic = 'force-dynamic';

export default async function AdminClientApprovalsPage() {
  const result = await loadPageData(async () => {
    const [approvals, accesses] = await Promise.all([
      listClientApprovalsForOrganization(),
      listClientAccesses(),
    ]);

    const active = accesses.filter((access) => access.status === 'active');
    const grantsByAccess = await Promise.all(
      active.map(async (access) => ({
        clientAccessId: access.id,
        grants: await listClientGrants(access.id),
      }))
    );

    return {
      approvals,
      clients: active.map((access) => ({
        id: access.id,
        name: access.contactName || access.email,
      })),
      grants: grantsByAccess.flatMap((entry) =>
        entry.grants
          .filter((grant) => !grant.revokedAt)
          .map((grant) => ({
            clientAccessId: entry.clientAccessId,
            resourceType: grant.resourceType,
            resourceId: grant.resourceId,
            label: `${grant.resourceType}: ${grant.title}`,
          }))
      ),
    };
  });

  if (!result.ok) return <PageStateNotice reason={result.reason} />;

  const { approvals, clients, grants } = result.data;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/admin/client-portal" className="text-sm text-accent hover:underline">
          ← Client portal
        </Link>
        <h1 className="text-2xl font-bold">Client approvals</h1>
        <p className="text-sm text-muted-foreground">
          Each decision records the client identity and timestamp. This is an approval record, not a
          certified e-signature.
        </p>
      </div>

      <section className="max-w-4xl rounded-md border bg-background p-6">
        <h2 className="mb-3 text-lg font-semibold">Request an approval</h2>
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active client portal access yet.</p>
        ) : (
          <RequestApprovalForm clients={clients} grants={grants} />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Requests</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b text-sm text-muted-foreground">
                <th className="pb-3 font-medium">Title</th>
                <th className="pb-3 font-medium">Client</th>
                <th className="pb-3 font-medium">Resource</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium text-right">Responded</th>
              </tr>
            </thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No client approvals requested yet.
                  </td>
                </tr>
              ) : (
                approvals.map((approval) => (
                  <tr key={approval.id} className="border-b text-sm">
                    <td className="py-3 font-medium">{approval.title}</td>
                    <td className="py-3 text-muted-foreground">{approval.clientName}</td>
                    <td className="py-3 text-muted-foreground">{approval.resourceType}</td>
                    <td className="py-3">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {approval.status}
                      </span>
                    </td>
                    <td className="py-3 text-right text-muted-foreground">
                      {approval.respondedAt ? approval.respondedAt.toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
