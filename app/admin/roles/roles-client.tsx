'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoRolesView } from '@/components/admin/bento-roles-view';
import type { RoleResponse } from '@/lib/services/admin/role-service';

interface RolesClientProps {
  roles: RoleResponse[];
}

export function RolesClient({ roles }: RolesClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoRolesView roles={roles} />;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Roles & Permissions</h1>
        <p className="text-sm text-muted-foreground">
          Manage custom roles and granular permissions for your organization.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Role Name</th>
              <th className="pb-3 font-medium">Description</th>
              <th className="pb-3 font-medium">Type</th>
              <th className="pb-3 font-medium">Permissions</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  No roles found.
                </td>
              </tr>
            ) : (
              roles.map((r) => (
                <tr key={r.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    {r.name}{' '}
                    {r.isSystem && <span className="text-xs text-muted-foreground">(system)</span>}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">{r.description || '—'}</td>
                  <td className="py-4 text-sm">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        r.isSystem ? 'bg-muted text-muted-foreground' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {r.isSystem ? 'System' : 'Custom'}
                    </span>
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">{r.permissions.length}</td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    {!r.isSystem && (
                      <Link
                        href={`/admin/roles/${r.id}`}
                        className="text-sm text-accent hover:underline"
                      >
                        Edit
                      </Link>
                    )}
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
