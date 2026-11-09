/**
 * AgencyOS CRM Account Edit page.
 * Server component that fetches the account and renders the edit form.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAccount } from '@/lib/services/crm/account-service';
import { EditAccountForm } from './EditAccountForm';

export default async function AccountEditPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const account = await getAccount(id);

  return <EditAccountForm account={account} />;
}
