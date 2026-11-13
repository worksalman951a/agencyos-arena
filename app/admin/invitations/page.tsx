/**
 * AgencyOS Invitations page.
 *
 * Lists outstanding invitations and lets an administrator invite an e-mail
 * address. The acceptance token is displayed exactly once, immediately after
 * creation, because only its hash is stored (see invitation-service).
 */

import { listInvitations } from '@/lib/services/admin/invitation-service';
import { listRoles } from '@/lib/services/admin/role-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { NewInvitationForm } from './NewInvitationForm';
import { InvitationActions } from './InvitationActions';

export default async function InvitationsPage() {
  const result = await loadPageData(async () => {
    const [invitations, roles] = await Promise.all([listInvitations(), listRoles()]);
    return { invitations, roles: roles.map((role) => ({ id: role.id, name: role.name })) };
  });

  if (!result.ok) return <PageStateNotice reason={result.reason} />;

  const { invitations, roles } = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Invitations</h1>
          <p className="text-sm text-muted-foreground">
            Invite teammates into this organization. Invitations expire after 7 days and are
            single-use.
          </p>
        </div>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-3xl">
        <h2 className="text-lg font-semibold mb-4">Invite a teammate</h2>
        <NewInvitationForm roles={roles} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">E-mail</th>
              <th className="pb-3 font-medium">Role</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium text-right">Expires</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invitations.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No invitations yet.
                </td>
              </tr>
            ) : (
              invitations.map((invitation) => (
                <tr key={invitation.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">{invitation.email}</td>
                  <td className="py-4 text-sm text-muted-foreground">{invitation.roleName}</td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        invitation.status === 'pending'
                          ? 'bg-blue-100 text-blue-800'
                          : invitation.status === 'accepted'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {invitation.status}
                    </span>
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    <InvitationActions id={invitation.id} status={invitation.status} />
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
