/**
 * AgencyOS CRM Accounts page.
 * Server component that lists accounts for the current organization.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listAccounts } from '@/lib/services/crm/account-service';

export default async function AccountsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Next.js 16: searchParams is a Promise; filters/pagination must be read after awaiting it.
  const searchParams = await searchParamsPromise;
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const page = Math.max(1, parseInt(String(searchParams.page ?? '1'), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(searchParams.pageSize ?? '20'), 10)));
  const search = String(searchParams.search ?? '');

  const { accounts, total, totalPages } = await listAccounts({
    page,
    pageSize,
    search: search || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    includeDeleted: false,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Accounts</h1>
        <Link
          href="/crm/accounts/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Account
        </Link>
      </div>

      <form className="flex gap-2 max-w-sm">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search accounts..."
          className="flex-1 border border-input rounded-md px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Search
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Website</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium w-24">Created</th>
              <th className="pb-3 font-medium">Contacts</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No accounts found.
                </td>
              </tr>
            ) : (
              accounts.map(
                (account: {
                  id: string;
                  name: string;
                  website: string | null;
                  status: string;
                  contactCount: number;
                  createdAt: Date;
                }) => (
                  <tr key={account.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">{account.name}</td>
                    <td className="py-4">{account.website ?? '—'}</td>
                    <td className="py-4">{account.status}</td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(account.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 text-muted-foreground text-sm">{account.contactCount}</td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Page {page} of {totalPages} ({total} total)
        </div>
      )}
    </div>
  );
}
