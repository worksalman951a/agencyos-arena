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
import { InvitationsClient } from './invitations-client';

export default async function InvitationsPage() {
  const result = await loadPageData(async () => {
    const [invitations, roles] = await Promise.all([listInvitations(), listRoles()]);
    return { invitations, roles: roles.map((role) => ({ id: role.id, name: role.name })) };
  });

  if (!result.ok) return <PageStateNotice reason={result.reason} />;

  const { invitations, roles } = result.data;

  return <InvitationsClient invitations={invitations} roles={roles} />;
}
