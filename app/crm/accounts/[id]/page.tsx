import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { getAccount } from '@/lib/services/crm/account-service';
import { AccountDetailClient } from './account-detail-client';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function AccountDetailPage({ params }: PageProps) {
  const cookieStore = await cookies();
  const sessionResult = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!sessionResult?.session || !sessionResult.user) {
    redirect('/login');
  }

  const { id } = await params;

  let account;
  try {
    account = await getAccount(id);
  } catch {
    notFound();
  }

  if (!account) {
    notFound();
  }

  const formattedAccount = {
    id: account.id,
    organizationId: account.organizationId,
    name: account.name,
    website: account.website,
    address: account.address,
    status: account.status,
    contactCount: account.contactCount,
    contacts: [],
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    deletedAt: account.deletedAt,
  };

  return (
    <div className="space-y-6 p-6">
      <AccountDetailClient account={formattedAccount} />
    </div>
  );
}
