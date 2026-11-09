/**
 * AgencyOS User Management page.
 * Lists organization users with role and status management.
 */

import Link from 'next/link';
import { listUsers } from '@/lib/services/admin/user-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

export default async function UsersPage() {
  const result = await loadPageData(() => listUsers());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const users = result.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Manage organization members, roles, and status.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Email</th>
              <th className="pb-3 font-medium">Role</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(
              users as Array<{
                id: string;
                name: string | null;
                email: string;
                role: string;
                status: string;
                createdAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  No users found.
                </td>
              </tr>
            ) : (
              (
                users as Array<{
                  id: string;
                  name: string | null;
                  email: string;
                  role: string;
                  status: string;
                  createdAt: Date;
                }>
              ).map((u) => (
                <tr key={u.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">{u.name || 'Unnamed'}</td>
                  <td className="py-4 text-sm text-muted-foreground">{u.email}</td>
                  <td className="py-4 text-sm font-medium">{u.role}</td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        u.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : u.status === 'suspended'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="text-sm text-accent hover:underline"
                    >
                      Edit
                    </Link>
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
