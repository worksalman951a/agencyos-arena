import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listAccounts } from '@/lib/services/crm/account-service';
import { AccountsClient } from './accounts-client';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AccountsPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const sessionResult = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!sessionResult?.session || !sessionResult.user) {
    redirect('/login');
  }

  const resolvedParams = await searchParams;
  const page = Math.max(1, parseInt(String(resolvedParams.page ?? '1'), 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(String(resolvedParams.pageSize ?? '20'), 10))
  );
  const search = String(resolvedParams.search ?? '');

  const { accounts, total, totalPages } = await listAccounts({
    page,
    pageSize,
    search: search || undefined,
    sortBy: 'name',
    sortOrder: 'asc',
    includeDeleted: false,
  });

  const formattedAccounts = accounts.map(
    (account: {
      id: string;
      organizationId: string;
      name: string;
      website: string | null;
      address: string | null;
      status: string;
      contactCount: number;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }) => ({
      id: account.id,
      organizationId: account.organizationId,
      name: account.name,
      website: account.website,
      address: account.address,
      status: account.status,
      contactCount: account.contactCount,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      deletedAt: account.deletedAt,
    })
  );

  return (
    <div className="space-y-6 p-6">
      <AccountsClient
        accounts={formattedAccounts}
        total={total}
        totalPages={totalPages}
        page={page}
        searchVal={search}
      />
    </div>
  );
}
