/**
 * AgencyOS Edit Member page.
 *
 * Role is chosen from the roles that actually exist in this organization (the
 * previous free-text-ish admin/employee list could not express a custom role and
 * disagreed with what the API accepted). Saves are validated and audited
 * server-side; the page only offers an action the service will accept.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoUserFormView } from '@/components/admin/bento-user-form-view';

interface RoleOption {
  id: string;
  name: string;
  isSystem: boolean;
}

interface MemberDetail {
  id: string;
  email: string;
  name: string | null;
  role: string;
  roles: string[];
  status: string;
}

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const isBento = useBentoShell();
  const router = useRouter();
  const [id, setId] = useState('');
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState('active');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (pid: string) => {
    const [memberRes, rolesRes] = await Promise.all([
      fetch(`/api/v1/admin/users/${pid}`, { credentials: 'include' }),
      fetch('/api/v1/admin/roles', { credentials: 'include' }),
    ]);
    if (!memberRes.ok) throw new Error('Failed to load member');
    if (!rolesRes.ok) throw new Error('Failed to load roles');

    const memberData = (await memberRes.json()) as MemberDetail;
    const roleData = (await rolesRes.json()) as RoleOption[];
    setMember(memberData);
    setStatus(memberData.status);

    // Preselect the role the member currently holds, when it is one of the
    // assignable roles in this organization.
    const current = roleData.find((role) => memberData.roles.includes(role.name));
    setRoles(roleData);
    setRoleId(current?.id ?? '');
  }, []);

  useEffect(() => {
    params.then(async ({ id: pid }) => {
      setId(pid);
      try {
        await load(pid);
      } catch (err) {
        setLoadError((err as Error).message);
      }
    });
  }, [params, load]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...(roleId ? { roleId } : {}),
          ...(status !== member?.status ? { status } : {}),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to update member');
      }

      toast.success('Member updated');
      router.push('/admin/users');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (isBento) {
    return (
      <BentoUserFormView
        member={member}
        roles={roles}
        roleId={roleId}
        setRoleId={setRoleId}
        status={status}
        setStatus={setStatus}
        onSubmit={handleSubmit}
        isLoading={saving}
        loadError={loadError}
      />
    );
  }

  // Legacy fallback view
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Edit Member</h1>
          {member ? <p className="text-sm text-muted-foreground">{member.email}</p> : null}
        </div>
        <Link
          href="/admin/users"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </Link>
      </div>

      {loadError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {loadError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="roleId">
            Role
          </label>
          <select
            id="roleId"
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="">Keep current role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
                {role.isSystem ? '' : ' (custom)'}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Assigning a role replaces the member&apos;s current role in this organization.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="invited">Invited</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
