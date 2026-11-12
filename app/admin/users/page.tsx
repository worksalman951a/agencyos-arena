/**
 * AgencyOS User Management page.
 * Lists organization users with role and status management.
 */

import { listUsers } from '@/lib/services/admin/user-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { UsersClient } from './users-client';

export default async function UsersPage() {
  const result = await loadPageData(() => listUsers());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const users = result.data;

  return <UsersClient users={users} />;
}
