/**
 * Client-portal administration.
 *
 * One screen for the three administrative jobs: invite a CRM contact, review the
 * portal identities of this organization, and manage what each of them can see.
 * Every action posts to an API route that re-checks the permission and the
 * organization scope; nothing here is trusted.
 */

import Link from 'next/link';

import { ClientAccessActions } from '@/components/portal/admin/client-access-actions';
import { InviteClientForm } from '@/components/portal/admin/invite-client-form';
import { RevokeGrantButton } from '@/components/portal/admin/revoke-grant-button';
import { ShareResourceForm } from '@/components/portal/admin/share-resource-form';
import { listContacts } from '@/lib/services/crm/contact-service';
import {
  listClientAccesses,
  listClientGrants,
  listShareableResources,
} from '@/lib/services/portal/client-access-service';
import { listClientInvitations } from '@/lib/services/portal/client-invitation-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export const dynamic = 'force-dynamic';

export default async function AdminClientPortalPage() {
  const result = await loadPageData(async () => {
    const [accesses, invitations, contacts, resources] = await Promise.all([
      listClientAccesses(),
      listClientInvitations(),
      listContacts({
        page: 1,
        pageSize: 100,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: false,
      }),
      listShareableResources(),
    ]);

    const grantsByAccess = await Promise.all(
      accesses.slice(0, 25).map(async (access) => ({
        accessId: access.id,
        grants: await listClientGrants(access.id),
      }))
    );

    return {
      accesses,
      invitations,
      contacts: contacts.contacts.map(
        (contact: {
          id: string;
          firstName: string | null;
          lastName: string;
          email: string | null;
        }) => ({
          id: contact.id,
          name: [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim(),
          email: contact.email ?? null,
        })
      ),
      resources: resources.map((resource) => ({
        type: resource.type,
        id: resource.id,
        title: resource.title,
      })),
      grantsByAccess: Object.fromEntries(
        grantsByAccess.map((entry) => [entry.accessId, entry.grants])
      ),
    };
  });

  if (!result.ok) return <PageStateNotice reason={result.reason} />;

  const { accesses, invitations, contacts, resources, grantsByAccess } = result.data;

  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Client portal</h1>
        <p className="text-sm text-muted-foreground">
          Invite client contacts, control their capabilities and share specific projects, documents
          and invoices. Clients only ever see what is listed here.
        </p>
      </div>

      <section className="max-w-4xl rounded-md border bg-background p-6">
        <h2 className="mb-4 text-lg font-semibold">Invite a client</h2>
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a CRM contact first — a portal identity is always bound to a contact.
          </p>
        ) : (
          <InviteClientForm contacts={contacts} />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Invitations</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b text-sm text-muted-foreground">
                <th className="pb-3 font-medium">E-mail</th>
                <th className="pb-3 font-medium">Contact</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium text-right">Expires</th>
              </tr>
            </thead>
            <tbody>
              {invitations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    No client invitations yet.
                  </td>
                </tr>
              ) : (
                invitations.map((invitation) => (
                  <tr key={invitation.id} className="border-b text-sm">
                    <td className="py-3 font-medium">{invitation.email}</td>
                    <td className="py-3 text-muted-foreground">{invitation.contactName}</td>
                    <td className="py-3">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {invitation.status}
                      </span>
                    </td>
                    <td className="py-3 text-right text-muted-foreground">
                      {invitation.expiresAt.toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Clients with portal access</h2>
          <div className="flex gap-3 text-sm">
            <Link href="/admin/client-portal/approvals" className="text-accent hover:underline">
              Approvals
            </Link>
            <Link href="/admin/client-portal/feedback" className="text-accent hover:underline">
              Client feedback
            </Link>
          </div>
        </div>

        {accesses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has accepted a portal invitation yet.
          </p>
        ) : (
          <ul className="space-y-4">
            {accesses.map((access) => {
              const grants = grantsByAccess[access.id] ?? [];
              return (
                <li
                  key={access.id}
                  className="rounded-md border bg-background p-4"
                  data-testid={`client-access-${access.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{access.contactName || access.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {access.email} · {access.role} · {access.grantCount} shared item(s) ·{' '}
                        {access.pendingApprovalCount} pending approval(s)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last seen:{' '}
                        {access.lastAccessAt ? access.lastAccessAt.toLocaleString() : 'never'}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs ${
                        access.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : access.status === 'suspended'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {access.status}
                    </span>
                  </div>

                  <div className="mt-3">
                    <ClientAccessActions access={access} />
                  </div>

                  {access.status !== 'revoked' ? (
                    <div className="mt-4 border-t pt-3">
                      <h3 className="text-sm font-semibold">Shared items</h3>
                      {grants.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nothing shared yet.</p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-sm">
                          {grants.map((grant) => (
                            <li key={grant.id} className="flex items-center justify-between gap-2">
                              <span>
                                <span className="text-xs uppercase text-muted-foreground">
                                  {grant.resourceType}
                                </span>{' '}
                                {grant.title}
                                {grant.revokedAt ? (
                                  <span className="ml-2 text-xs text-red-700">revoked</span>
                                ) : null}
                              </span>
                              {grant.revokedAt ? null : (
                                <RevokeGrantButton accessId={access.id} grantId={grant.id} />
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="mt-3">
                        <ShareResourceForm accessId={access.id} resources={resources} />
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
