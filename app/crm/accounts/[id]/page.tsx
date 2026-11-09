/**
 * AgencyOS CRM Account Detail page.
 * Server component that shows account details with related contacts.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAccount } from '@/lib/services/crm/account-service';

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const account = await getAccount(id);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{account.name}</h1>
          <p className="text-muted-foreground">
            {account.website ?? 'No website'} &bull; {account.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/crm/accounts/new"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Account
          </Link>
          <Link
            href={`/crm/accounts/${account.id}/edit`}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Edit
          </Link>
          <Link
            href="/crm/accounts"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Accounts
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Account Details</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="font-medium">{account.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Website</dt>
              <dd className="font-medium">
                {account.website ?? <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Address</dt>
              <dd className="font-medium">
                {account.address ?? <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd
                className={`font-medium ${
                  account.status === 'active'
                    ? 'text-green-800'
                    : account.status === 'inactive'
                      ? 'text-red-800'
                      : 'text-muted-foreground'
                }`}
              >
                {account.status}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Contacts</dt>
              <dd className="font-medium">{account.contactCount}</dd>
            </div>
            {account.deletedAt && (
              <div>
                <dt className="text-xs text-muted-foreground">Deleted At</dt>
                <dd className="font-medium text-destructive">
                  {new Date(account.deletedAt).toLocaleDateString()}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="col-span-2 bg-card p-6 rounded-lg border border-border">
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Audit Information</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs text-muted-foreground">Created At</dt>
              <dd className="font-medium">{new Date(account.createdAt).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Updated At</dt>
              <dd className="font-medium">{new Date(account.updatedAt).toLocaleDateString()}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
