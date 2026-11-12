/**
 * AgencyOS Role Management page.
 * Lists organization roles with permission assignments.
 */

import { listRoles } from '@/lib/services/admin/role-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { RolesClient } from './roles-client';

export default async function RolesPage() {
  const result = await loadPageData(() => listRoles());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const roles = result.data;

  return <RolesClient roles={roles} />;
}
